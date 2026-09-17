// Applies a patient's saved food-item replacements directly to a .docx
// file's underlying XML, producing a patient-specific modified copy for
// download — the shared template file on disk (served by /api/diet-file)
// is never touched.
//
// Word (and docx-preview) can split one visible word across several
// adjacent <w:t> runs (bold/italic mid-word, spell-check artifacts, ...),
// exactly the same problem client/src/lib/foodMatch.js solves for the
// rendered DOM: flatten every <w:t> run's text into one string with an
// offset map, search that flat string, then splice only the run(s) the
// match actually falls in — leaving every other byte of the XML untouched
// (run properties, formatting, images, tables, everything) so the
// document's original look is preserved.
const JSZip = require('jszip');

// XML files that can carry visible document text. word/document.xml (the
// main body) covers virtually all real diet-chart content; headers/
// footers/footnotes are included too in case a template ever puts
// something relevant there.
const XML_PART_PATTERN = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

function decodeXmlText(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function encodeXmlText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Every <w:t>...</w:t> run in `xml`, in document order, with both its
 * decoded text and its exact [start,end) byte range in `xml` (inner text
 * only — the surrounding <w:t ...> / </w:t> tags are left alone). */
function findTextRuns(xml) {
  const pattern = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  const runs = [];
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = pattern.exec(xml))) {
    const innerRaw = m[2];
    const openTagLen = m[0].length - innerRaw.length - '</w:t>'.length;
    const innerStart = m.index + openTagLen;
    runs.push({ start: innerStart, end: innerStart + innerRaw.length, decoded: decodeXmlText(innerRaw) });
  }
  return runs;
}

/** Finds the first (case-insensitive) occurrence of `originalText` across
 * every run's decoded text and splices `replacementText` in over just that
 * span, updating only the run(s) it falls in. Returns the new xml string,
 * or the input unchanged if no occurrence was found. */
function replaceOnce(xml, originalText, replacementText) {
  const runs = findTextRuns(xml);
  if (!runs.length) return xml;

  let flat = '';
  const map = []; // { start, end, run }
  for (const run of runs) {
    const start = flat.length;
    flat += run.decoded;
    map.push({ start, end: flat.length, run });
  }

  const idx = flat.toLowerCase().indexOf(originalText.toLowerCase());
  if (idx === -1) return xml;
  const matchStart = idx;
  const matchEnd = idx + originalText.length;

  const affected = map.filter((e) => e.end > matchStart && e.start < matchEnd);
  if (!affected.length) return xml;
  const firstAffectedRun = affected[0].run;

  // Rightmost-run-first so earlier splice offsets in `xml` stay valid as
  // later (leftward) splices are applied.
  const bySplicePosition = [...affected].sort((a, b) => b.run.start - a.run.start);
  let out = xml;
  for (const entry of bySplicePosition) {
    const { run } = entry;
    const localStart = Math.max(0, matchStart - entry.start);
    const localEnd = Math.min(run.decoded.length, matchEnd - entry.start);
    const before = run.decoded.slice(0, localStart);
    const after = run.decoded.slice(localEnd);
    const middle = run === firstAffectedRun ? replacementText : '';
    const newDecoded = before + middle + after;
    out = out.slice(0, run.start) + encodeXmlText(newDecoded) + out.slice(run.end);
  }
  return out;
}

/**
 * @param {Buffer} docxBuffer - the original, unmodified .docx file's bytes
 * @param {Array<{originalText: string, replacementText: string}>} replacements
 *   - applied in order; each pass only ever touches the *first* remaining
 *   occurrence of its originalText, so N saved entries for the same word
 *   (e.g. "egg" flagged at 3 different spots) correctly consume 3 distinct
 *   occurrences one at a time, mirroring how the client re-applies saved
 *   replacements on reload (see reapplySavedReplacement in foodMatch.js).
 * @returns {Promise<Buffer>} the modified .docx file's bytes
 */
async function applyReplacementsToDocx(docxBuffer, replacements) {
  const zip = await JSZip.loadAsync(docxBuffer);
  const partNames = Object.keys(zip.files).filter((name) => XML_PART_PATTERN.test(name));

  for (const name of partNames) {
    let xml = await zip.file(name).async('string');
    for (const { originalText, replacementText } of replacements) {
      if (!originalText || !replacementText) continue;
      xml = replaceOnce(xml, originalText, replacementText);
    }
    zip.file(name, xml);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = { applyReplacementsToDocx };
