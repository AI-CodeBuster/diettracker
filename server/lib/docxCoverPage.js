// Strips the "cover page" from a gear template's .docx — the patient
// questionnaire and table of contents every template opens with — so it can
// be shown as a continuation of an earlier gear's diet plan instead of
// restarting with its own patient-detail page. Deliberately leaves the
// title/quote/attribution block that follows (e.g. "Gear 5 Diet Chart" +
// the "focus on what you eat" quote) in place as the visible lead-in to
// that gear's own schedule table, rather than cutting straight to the bare
// table.
//
// There's no actual page-break marker to key off: Word pagination is
// computed from layout at render time, not stored in the file. What every
// sampled template *does* have is a real structural landmark — its first
// <w:tbl> — but that table is sometimes the actual meal-schedule table
// (e.g. most Gear 3 templates) and sometimes a "Serial No / Content / Page
// No" table of contents that precedes it (most Gear 4 templates, and some
// Gear 3 templates), in which case the real schedule starts with the
// title/quote paragraphs right after that ToC table closes. Both shapes
// were confirmed across DIABETES/THYROID/KIDNEY DIET/GASTRIC-ULCER-ACIDITY
// samples.
//
// If a template doesn't have any table at all, nothing is stripped —
// guessing wrong here would delete real diet content, so the safe fallback
// is to show the template's own cover page rather than risk that.
const JSZip = require('jszip');

const TOC_KEYWORDS = ['serial', 'content', 'page number', 'வரிசை எண்', 'பொருளடக்கம்', 'பக்கம்'];

function findNextTbl(xml, fromIndex) {
  const m = /<w:tbl[ >]/.exec(xml.slice(fromIndex));
  return m ? fromIndex + m.index : -1;
}

// Word tables routinely nest one <w:tbl> inside another cell purely for
// layout, so the *first* </w:tbl> found after tblStart is often the nested
// table's close, not this table's own — landing well inside the table
// instead of after it. Tracks nesting depth to find the real matching close.
function tblCloseIndex(xml, tblStart) {
  const tagRe = /<(\/?)w:tbl(\s[^>]*)?>/g;
  tagRe.lastIndex = tblStart;
  let depth = 0;
  let m;
  while ((m = tagRe.exec(xml))) {
    if (m[1] === '/') {
      depth--;
      if (depth === 0) return m.index + m[0].length;
    } else {
      depth++;
    }
  }
  return -1;
}

function tblText(xml, tblStart, tblEnd) {
  return [...xml.slice(tblStart, tblEnd).matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(' ');
}

function looksLikeTableOfContents(text) {
  const lower = text.toLowerCase();
  return TOC_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

// Word wraps its generated Table of Contents — and, in a good third of the
// sampled templates, the schedule table itself — in a <w:sdt> "content
// control" element (<w:sdt><w:sdtPr>...</w:sdtPr><w:sdtContent><w:tbl>...
// </w:sdtContent></w:sdt>). A splitPoint landing inside one and slicing
// there is well-formed enough that a crude "can I still extract <w:t> text"
// check won't notice, but produces XML a real parser (docx-preview's)
// rejects — either dangling closing tags with no opener (splitPoint kept
// everything from there on) or a dangling opener with no closer (splitPoint
// discarded everything up to there). Which fix is correct depends on which
// direction the cut is guarding.
function enclosingSdtStack(xml, from, pos) {
  const tagRe = /<(\/?)w:sdt(\s[^>]*)?>/g;
  tagRe.lastIndex = from;
  const openStack = [];
  let m;
  while ((m = tagRe.exec(xml)) && m.index < pos) {
    if (m[1] === '/') {
      if (openStack.length) openStack.pop();
    } else {
      openStack.push(m.index);
    }
  }
  return openStack;
}

function sdtCloseIndex(xml, sdtStart) {
  const tagRe = /<(\/?)w:sdt(\s[^>]*)?>/g;
  tagRe.lastIndex = sdtStart;
  let depth = 0;
  let m;
  while ((m = tagRe.exec(xml))) {
    if (m[1] === '/') {
      depth--;
      if (depth === 0) return m.index + m[0].length;
    } else {
      depth++;
    }
  }
  return -1;
}

// splitPoint marks where the *kept* content starts — if it falls inside an
// unclosed <w:sdt>, retreat to that wrapper's own opening tag so the kept
// portion includes the whole wrapper (used when splitPoint lands on real
// content to keep, e.g. the schedule table itself was SDT-wrapped).
function backUpToEnclosingSdt(xml, from, splitPoint) {
  const stack = enclosingSdtStack(xml, from, splitPoint);
  return stack.length ? stack[0] : splitPoint;
}

// splitPoint marks where the *stripped* content ends — if it falls inside
// an unclosed <w:sdt> (the ToC table itself was SDT-wrapped), advance past
// that wrapper's own closing tag instead, so nothing strips a dangling
// </w:sdtContent></w:sdt> with no matching opener still ahead of it.
function advancePastEnclosingSdt(xml, from, splitPoint) {
  const stack = enclosingSdtStack(xml, from, splitPoint);
  if (!stack.length) return splitPoint;
  const close = sdtCloseIndex(xml, stack[0]);
  return close === -1 ? splitPoint : close;
}

/**
 * @param {Buffer} docxBuffer - the original, unmodified .docx file's bytes
 * @returns {Promise<Buffer>} the same document with its cover page removed,
 *   or the original bytes unchanged if no safe split point was found
 */
async function stripCoverPage(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);
  const partPath = 'word/document.xml';
  const file = zip.file(partPath);
  if (!file) return docxBuffer;

  const xml = await file.async('string');
  const bodyOpen = xml.indexOf('<w:body>');
  if (bodyOpen === -1) return docxBuffer;

  let splitPoint = findNextTbl(xml, bodyOpen);
  if (splitPoint === -1) return docxBuffer;

  const firstClose = tblCloseIndex(xml, splitPoint);
  if (firstClose !== -1 && looksLikeTableOfContents(tblText(xml, splitPoint, firstClose))) {
    // Stop right after the ToC table itself, not at the next <w:tbl> — the
    // paragraphs between here and the real schedule table are the gear's
    // own title + quote + attribution, not front-matter clutter. That
    // ToC table is frequently SDT-wrapped, so advance (not retreat) past
    // it: splitPoint here marks the end of what's being *stripped*.
    splitPoint = advancePastEnclosingSdt(xml, bodyOpen, firstClose);
  } else {
    // No ToC table — splitPoint marks the start of real content to *keep*,
    // so if it lands inside an SDT wrapper, retreat to include the whole
    // wrapper rather than orphaning its closing tags.
    splitPoint = backUpToEnclosingSdt(xml, bodyOpen, splitPoint);
  }

  const bodyContentStart = bodyOpen + '<w:body>'.length;
  const newXml = xml.slice(0, bodyContentStart) + xml.slice(splitPoint);
  zip.file(partPath, newXml);
  // JSZip stores entries uncompressed by default, unlike the DEFLATE-
  // compressed zip Word itself produces — without this, an already-large
  // diet chart (some run 15-20MB) balloons further, and this one gets
  // fetched 1-2 extra times per page view (once per appended gear).
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { stripCoverPage };
