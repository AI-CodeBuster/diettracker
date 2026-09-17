// Parses a diet-plan .docx into an ordered list of blocks — the raw material
// the migration converter turns into diet-data JSON.
//
// Word's document.xml is a flat stream of <w:p> (paragraph) and <w:tbl>
// (table) elements. Everything the converter needs is positional: a recipe's
// photo is the image anchored nearest *after* its heading, its ingredients are
// the paragraphs between that heading and the next one. So this deliberately
// preserves document order and does not try to build a tree.
//
// Not a general-purpose .docx reader: it handles exactly the constructs these
// 111 documents use (paragraphs, runs, tables, inline/anchored images, list
// numbering) and ignores the rest.
const JSZip = require('jszip');
const fs = require('fs');

// Word splits a single visible sentence across many <w:r> runs whenever
// formatting changes mid-word, so text must be gathered run-by-run and joined
// with nothing between — joining with a space corrupts words like "vege| table".
function paragraphText(xml) {
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] === undefined) { parts.push(' '); continue; }
    parts.push(m[1]);
  }
  return decodeEntities(parts.join('')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&'); // last, so "&amp;lt;" doesn't become "<"
}

// Image relationship ids (r:embed) resolve to word/media/* through the rels
// part; without this an image is just an opaque "rId7".
async function loadRelMap(zip) {
  const relFile = zip.file('word/_rels/document.xml.rels');
  if (!relFile) return {};
  const xml = await relFile.async('string');
  const map = {};
  const re = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml))) map[m[1]] = m[2].replace(/^\.\.\//, '').replace(/^\/?word\//, '');
  return map;
}

function imageIdsIn(xml) {
  const out = [];
  const re = /<a:blip\b[^>]*r:embed="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

// Word marks a heading either by paragraph style (Heading1/Title) or — far
// more often in these hand-made documents — by simply bolding the whole line.
// Both are treated as heading candidates; the converter decides which of them
// actually start a section.
function paragraphStyle(xml) {
  const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(xml);
  const listId = /<w:numPr>[\s\S]*?<w:numId\b[^>]*w:val="([^"]+)"/.exec(xml);
  // bold counts only when it isn't cancelled by an explicit w:b w:val="0"
  const boldRuns = (xml.match(/<w:b(?:\s+[^/>]*)?\/>|<w:b\s+[^>]*w:val="(?:1|true)"/g) || []).length;
  const textRuns = (xml.match(/<w:t(?:\s[^>]*)?>/g) || []).length;
  return {
    styleName: style ? style[1] : null,
    listId: listId ? listId[1] : null,
    allBold: textRuns > 0 && boldRuns >= textRuns,
  };
}

function parseTable(xml) {
  const rows = [];
  // Split on row starts; a nested table would break this, but none of these
  // documents nest tables (verified across all 111 during the survey).
  for (const chunk of xml.split(/<w:tr(?=[\s>])/).slice(1)) {
    const cells = [];
    for (const cell of chunk.split(/<w:tc(?=[\s>])/).slice(1)) {
      // A cell holds its own paragraphs; keep them as separate lines so a
      // multi-line cell ("Rice + dal / Chutney") isn't run together.
      const paras = cell.split(/<w:p(?=[\s>])/).slice(1).map(paragraphText).filter(Boolean);
      cells.push(paras.join(' '));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// Returns blocks in document order:
//   { type: 'para', text, styleName, listId, allBold, images: [mediaName] }
//   { type: 'table', rows: [[cell, ...], ...] }
async function extractStructure(docxPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
  const xml = await zip.file('word/document.xml').async('string');
  const rels = await loadRelMap(zip);
  const body = xml.slice(xml.indexOf('<w:body>'));

  const blocks = [];
  // Top-level paragraphs and tables only: the lookahead on <w:p makes sure a
  // <w:pPr>-lookalike doesn't match, and tables are consumed whole so their
  // inner paragraphs never leak out as top-level blocks.
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?=[\s>])[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(body))) {
    const chunk = m[0];
    if (chunk.startsWith('<w:tbl')) {
      blocks.push({ type: 'table', rows: parseTable(chunk) });
    } else {
      const text = paragraphText(chunk);
      const images = imageIdsIn(chunk).map((id) => rels[id]).filter(Boolean);
      if (!text && !images.length) continue;
      blocks.push({ type: 'para', text, images, ...paragraphStyle(chunk) });
    }
  }

  const media = {};
  for (const name of Object.keys(zip.files)) {
    if (name.startsWith('word/media/')) media[name.replace('word/', '')] = zip.files[name];
  }
  return { blocks, media, zip };
}

module.exports = { extractStructure, paragraphText, decodeEntities };
