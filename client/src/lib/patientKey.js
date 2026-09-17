// Mirrors server/lib/patientKey.js exactly — the client needs to compute
// the same key to call /api/patient-data/:personKey and friends. Keep both
// in sync if this logic ever changes.

function slug(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function patientKey(sheetName, person) {
  // No ":" in the key — Windows treats "name:suffix" as an NTFS Alternate
  // Data Stream on the underlying file, silently writing to "name" instead
  // of creating "name:suffix" as a real file.
  if (person.studentId && person.studentId.trim()) {
    return `sid_${slug(person.studentId)}`;
  }
  return `row_${slug(`${sheetName}-${person.name}-${person.contact || ''}`)}`;
}

export { patientKey };
