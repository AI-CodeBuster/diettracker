// Writes a TL's verification + remarks straight into the matching person's
// row in the live (duplicate) Google Sheet — the one place this data is
// meant to be seen by anyone opening the spreadsheet directly, not just
// inside this app. Reuses the exact same header-matching rules sheetSchema.js
// uses to *read* these columns (see sheetColumns.js), so a write can never
// land in a column the read side wouldn't recognize as the same field.
//
// Locates the target row through the raw grid (sheetGrid.js) rather than the
// public CSV export — see the comment there for why: the CSV export and the
// raw grid a write addresses don't always agree on which row is "row 1".
const { findAllExact, zipToGearBlocks } = require('./sheetColumns');
const { fetchGrid, findHeaderRowIndex, findStudentRow } = require('./sheetGrid');
const { getSheetsClient } = require('./googleSheetsClient');

// Matches the sheet's own data-validation dropdowns exactly (Template tab).
const DIET_ACCURACY_VALUES = new Set(['Yes', 'No', 'NA']);
const DIET_QUALITY_VALUES = new Set([
  'Yes',
  'Clarity and readability error',
  'grammar/ spelling/wording error',
  'format error',
  'visual / image error',
  'overall professionalism error',
  'overall alignment error',
  'NA',
]);

function colToLetter(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function locateColumns(headers) {
  const tlVerificationIdxs = findAllExact(headers, (h) => /\btl\b/.test(h) && /verif/.test(h) && !/date/.test(h));
  const tlVerificationCols = zipToGearBlocks(tlVerificationIdxs, headers);

  const tlDateIdxs = findAllExact(headers, (h) => /\btl\b/.test(h) && /verif/.test(h) && /date/.test(h));
  const tlDateCols = zipToGearBlocks(tlDateIdxs, headers);

  const tlRemarksIdxs = findAllExact(headers, (h) => /\btl\b/.test(h) && /remark/.test(h));
  const tlRemarksCols = zipToGearBlocks(tlRemarksIdxs, headers);

  const accuracyIdxs = findAllExact(headers, (h) => /diet accuracy/.test(h) && /tl/.test(h));
  const accuracyCols = zipToGearBlocks(accuracyIdxs, headers);

  const qualityIdxs = findAllExact(headers, (h) => /diet quality/.test(h) && /tl/.test(h));
  const qualityCols = zipToGearBlocks(qualityIdxs, headers);

  return { tlVerificationCols, tlDateCols, tlRemarksCols, accuracyCols, qualityCols };
}

// Matches the sheet's own "5-Sep-2026" style dates.
function formatSheetDate(date) {
  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

async function writeTLVerification({ spreadsheetId, sheetName, studentId, gear, verified, dietAccuracy, dietQuality, remarks }) {
  if (dietAccuracy !== undefined && dietAccuracy !== '' && !DIET_ACCURACY_VALUES.has(dietAccuracy)) {
    throw new Error(`dietAccuracy must be one of: ${[...DIET_ACCURACY_VALUES].join(', ')}`);
  }
  if (dietQuality !== undefined && dietQuality !== '' && !DIET_QUALITY_VALUES.has(dietQuality)) {
    throw new Error(`dietQuality must be one of: ${[...DIET_QUALITY_VALUES].join(', ')}`);
  }

  const grid = await fetchGrid({ spreadsheetId, sheetName });
  const headerRowIndex = findHeaderRowIndex(grid);
  if (headerRowIndex < 0) throw new Error('Could not find a Student ID column on this sheet');
  const headers = grid[headerRowIndex];

  const idIdx = headers.findIndex((h) => /student/i.test(h || '') && /id/i.test(h || ''));
  const sheetRow = findStudentRow(grid, headerRowIndex, idIdx, studentId);
  if (sheetRow < 0) throw new Error(`Student ID ${studentId} not found on "${sheetName}"`);

  const { tlVerificationCols, tlDateCols, tlRemarksCols, accuracyCols, qualityCols } = locateColumns(headers);

  const updates = [];
  const pushIfKnown = (cols, value) => {
    if (value === undefined) return;
    const colIdx = cols[gear];
    if (colIdx === undefined) return;
    updates.push({ range: `'${sheetName}'!${colToLetter(colIdx)}${sheetRow}`, values: [[value]] });
  };

  pushIfKnown(tlVerificationCols, verified === undefined ? undefined : verified ? 'Verified' : '');
  pushIfKnown(tlDateCols, verified === undefined ? undefined : verified ? formatSheetDate(new Date()) : '');
  pushIfKnown(tlRemarksCols, remarks);
  pushIfKnown(accuracyCols, dietAccuracy);
  pushIfKnown(qualityCols, dietQuality);

  if (!updates.length) {
    throw new Error(`"${sheetName}" has none of the TL verification columns for Gear ${gear} yet`);
  }

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
  });

  return { sheetRow, updatedRanges: updates.map((u) => u.range) };
}

module.exports = { writeTLVerification, DIET_ACCURACY_VALUES, DIET_QUALITY_VALUES };
