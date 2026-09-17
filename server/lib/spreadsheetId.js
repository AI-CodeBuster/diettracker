// Pulls a spreadsheet id out of a pasted Google Sheets URL (any of the
// common forms — /d/{id}/edit, /d/{id}/edit#gid=0, /d/{id}/view, ...), or
// accepts a bare id typed directly.
const ID_PATTERN = /^[a-zA-Z0-9_-]{10,100}$/;

function extractSpreadsheetId(input) {
  const text = (input || '').trim();
  if (!text) return null;
  const m = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return ID_PATTERN.test(text) ? text : null;
}

module.exports = { extractSpreadsheetId, ID_PATTERN };
