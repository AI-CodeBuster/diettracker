// Dynamic search: matches if the query is a substring anywhere in the name
// (handles "related letters" mid-word), or if any word in the name/id/batch
// starts with the query (handles fast first-letter narrowing as you type).
function matchesQuery(person, rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  const haystacks = [person.name, person.studentId, person.batch, person.hcName].filter(Boolean);
  for (const text of haystacks) {
    const lower = text.toLowerCase();
    if (lower.includes(query)) return true;
    if (lower.split(/\s+/).some((word) => word.startsWith(query))) return true;
  }
  return false;
}

// Generic fallback for non-person sheets (e.g. batch-level tables): search
// across every cell in the row.
function matchesQueryGeneric(row, rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  return Object.values(row.raw || {}).some((v) => String(v).toLowerCase().includes(query));
}

export { matchesQuery, matchesQueryGeneric };
