// Reads the sheet's raw grid through the SAME authenticated Sheets API the
// writers use to address cells (spreadsheets.values.update/batchUpdate),
// specifically so "this is row N" always means the same row for locating a
// cell and for writing to it.
//
// This app's *display* reads all go through the public, unauthenticated
// gviz/CSV export instead (fetchSheetCSV in server/index.js) — and that
// export silently drops a leading section-title row when one exists (some
// tabs have a merged "BASIC DETAILS / GEAR 4 DIET.../..." banner row above
// the real column headers; gviz's CSV never shows it, quietly renumbering
// every row beneath it by one). A writer that located a row by counting CSV
// rows but then wrote to that same row number through the raw API landed one
// row too high — on a tab with that banner row, it silently overwrote the
// header instead of the intended person. Locating and writing through the
// same raw grid, with the header row found dynamically rather than assumed
// to be row 1, is what actually fixes that rather than papering over it with
// a guessed offset (which would only be right for tabs shaped exactly like
// the one it was guessed from).
const { normHeader, findIndex } = require('./sheetColumns');
const { getSheetsClient } = require('./googleSheetsClient');

async function fetchGrid({ spreadsheetId, sheetName }) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'`,
  });
  return res.data.values || [];
}

// Scans from the top for the first row that actually looks like the real
// column-header row (has a Student ID-ish column) — same signal
// sheetSchema.js already relies on to know a sheet is a person sheet at all.
// Only checks the first handful of rows: real tabs have at most one banner
// row above the header, never more.
function findHeaderRowIndex(grid) {
  const limit = Math.min(grid.length, 5);
  for (let i = 0; i < limit; i++) {
    if (findIndex(grid[i] || [], [/student/, /id/]) >= 0) return i;
  }
  return -1;
}

// Returns the 1-indexed spreadsheet row number for the given Student ID, or
// -1 if not found among the rows after the detected header.
function findStudentRow(grid, headerRowIndex, idColIdx, studentId) {
  const target = String(studentId).trim();
  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const cell = (grid[i][idColIdx] || '').trim();
    if (cell === target) return i + 1; // +1: grid is 0-indexed, spreadsheet rows are 1-indexed
  }
  return -1;
}

module.exports = { fetchGrid, findHeaderRowIndex, findStudentRow, normHeader };
