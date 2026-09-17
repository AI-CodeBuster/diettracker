// One-off migration: inserts "Diet Accuracy (TL)" and "Diet Quality (TL)"
// columns into a real per-person tab, immediately before each gear's
// existing "TL verification" column (gears 2/3/4) — the same two fields the
// tracker's "Template" reference tab already shows, added to the real tabs
// so the app's TL Verify modal has somewhere to actually save them.
//
// Processes gears in descending column-index order, and — critically —
// writes each gear's header text immediately after inserting its columns,
// before moving to the next (lower-index) gear. A later insert at a lower
// index still shifts everything above it, including a header already
// written for a higher-index gear — but since it shifts the correct text
// together with the rest of that block, it stays correctly placed. Writing
// all the header text in one batch *after* every insert was already done
// (the first version of this script) got this backwards: a lower-index
// insert would shift a higher-index gear's *blank* columns away from the
// position the header-text step still thought they were at, so the text
// landed on top of unrelated existing header cells instead. Interleaving
// insert-then-write per gear avoids that entirely.
//
// Usage: node scripts/add-tl-rating-columns.js "<sheet name>"
require('dotenv').config();
const { fetchGrid, findHeaderRowIndex } = require('../lib/sheetGrid');
const { findAllExact, zipToGearBlocks } = require('../lib/sheetColumns');
const { getSheetsClient } = require('../lib/googleSheetsClient');

const SPREADSHEET_ID = '1DKK_qQi4SuPOPSHzQhV6xgwLjPBlS98sSEckEtOZ_yY';

function colLetter(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function getSheetId(sheets, sheetName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets.find((s) => s.properties.title === sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
  return sheet.properties.sheetId;
}

async function main() {
  const sheetName = process.argv[2];
  if (!sheetName) throw new Error('Usage: node add-tl-rating-columns.js "<sheet name>"');

  const grid = await fetchGrid({ spreadsheetId: SPREADSHEET_ID, sheetName });
  const headerRowIndex = findHeaderRowIndex(grid);
  if (headerRowIndex < 0) throw new Error(`No Student ID column found on "${sheetName}"`);
  const headers = grid[headerRowIndex];

  const existingAccuracy = findAllExact(headers, (h) => /diet accuracy/.test(h) && /tl/.test(h));
  if (existingAccuracy.length) {
    console.log(`"${sheetName}" already has a Diet Accuracy (TL) column — skipping, nothing to do.`);
    return;
  }

  const tlVerificationIdxs = findAllExact(headers, (h) => /\btl\b/.test(h) && /verif/.test(h) && !/date/.test(h));
  const tlVerificationCols = zipToGearBlocks(tlVerificationIdxs, headers);

  const gears = [2, 3, 4].filter((g) => tlVerificationCols[g] !== undefined);
  if (!gears.length) throw new Error(`No "TL verification" column found for any gear on "${sheetName}"`);

  // Descending by column index: each gear's insert+write completes fully
  // before the next (lower-index) gear's insert can shift it.
  const orderedGears = [...gears].sort((a, b) => tlVerificationCols[b] - tlVerificationCols[a]);

  const sheets = await getSheetsClient();
  const sheetId = await getSheetId(sheets, sheetName);
  const headerRange1Based = headerRowIndex + 1;

  for (const gear of orderedGears) {
    const colIdx = tlVerificationCols[gear];
    console.log(`Gear ${gear}: inserting at col${colIdx} (before "TL verification")`);

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          insertDimension: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: colIdx, endIndex: colIdx + 2 },
            inheritFromBefore: false,
          },
        }],
      },
    });

    const range = `'${sheetName}'!${colLetter(colIdx)}${headerRange1Based}:${colLetter(colIdx + 1)}${headerRange1Based}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Diet Accuracy (TL)', 'Diet Quality (TL)']] },
    });
    console.log(`Gear ${gear}: wrote headers at ${range}`);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
