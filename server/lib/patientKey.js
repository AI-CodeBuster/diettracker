// Mirrors client/src/lib/patientKey.js exactly. Every other store keys off
// a personKey the client computed and passed in a URL param, but the
// weight-log auto-capture (server/index.js's /api/sheets/:name handler)
// runs server-side with no client round-trip per row, so it needs to derive
// the same key itself. Keep both in sync if this logic ever changes.
function slug(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function patientKey(sheetName, person) {
  if (person.studentId && person.studentId.trim()) {
    return `sid_${slug(person.studentId)}`;
  }
  return `row_${slug(`${sheetName}-${person.name}-${person.contact || ''}`)}`;
}

module.exports = { patientKey };
