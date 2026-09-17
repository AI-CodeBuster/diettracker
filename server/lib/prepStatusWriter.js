// Writes "Done" into a gear's own "Gear N Preparation status" cell — the
// "Mark Prepared" action a Team Member takes from inside the app instead of
// editing the sheet directly, mirroring how TL verification already replaced
// editing the sheet's TL columns by hand (see tlVerificationWriter.js).
//
// Locates the target row through the raw grid (sheetGrid.js) rather than the
// public CSV export — see the comment there for why: the CSV export and the
// raw grid a write addresses don't always agree on which row is "row 1".
const { findIndex } = require('./sheetColumns');
const { fetchGrid, findHeaderRowIndex, findStudentRow } = require('./sheetGrid');
const { getSheetsClient } = require('./googleSheetsClient');

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

async function writePrepStatus({ spreadsheetId, sheetName, studentId, gear }) {
  const grid = await fetchGrid({ spreadsheetId, sheetName });
  const headerRowIndex = findHeaderRowIndex(grid);
  if (headerRowIndex < 0) throw new Error('Could not find a Student ID column on this sheet');
  const headers = grid[headerRowIndex];

  const idIdx = headers.findIndex((h) => /student/i.test(h || '') && /id/i.test(h || ''));
  const sheetRow = findStudentRow(grid, headerRowIndex, idIdx, studentId);
  if (sheetRow < 0) throw new Error(`Student ID ${studentId} not found on "${sheetName}"`);

  const statusIdx = findIndex(headers, [new RegExp(`gear\\s*${gear}`), /preparation status/]);
  if (statusIdx < 0) throw new Error(`"${sheetName}" has no "Gear ${gear} Preparation status" column`);

  const range = `'${sheetName}'!${colToLetter(statusIdx)}${sheetRow}`;
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['Done']] },
  });

  return { sheetRow, updatedRange: range };
}

module.exports = { writePrepStatus };
