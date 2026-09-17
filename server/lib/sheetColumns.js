// Shared header-matching helpers used by both the read side (sheetSchema.js,
// parsing a sheet into per-person rows) and the write side
// (tlVerificationWriter.js, locating exactly which cell to update) — kept in
// one place so the two can never silently disagree about which column is
// "TL verification" vs "TL Verification Date" vs "TL Remarks".
function normHeader(h) {
  return (h || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function findIndex(headers, mustInclude, mustExclude = []) {
  for (let i = 0; i < headers.length; i++) {
    const h = normHeader(headers[i]);
    if (!h) continue;
    if (mustInclude.every((re) => re.test(h)) && !mustExclude.some((re) => re.test(h))) return i;
  }
  return -1;
}

function findAllExact(headers, matcher) {
  const idxs = [];
  headers.forEach((h, i) => { if (matcher(normHeader(h))) idxs.push(i); });
  return idxs;
}

// Several sub-columns (Diet type, Blood report Verification & Analysis, TL
// verification, blood-finding fields...) repeat once per gear block
// (GEAR4/GEAR3/GEAR2). An occurrence whose own header names its gear
// ("...GEAR 3...") is trusted directly; the rest are assigned positionally,
// left-to-right, in GEAR4/GEAR3/GEAR2 order — the same order the sheet
// always lays the blocks out in.
function zipToGearBlocks(idxs, headers) {
  const cols = {};
  const positional = [];
  idxs.forEach((idx) => {
    const m = normHeader(headers[idx]).match(/gear\s*([234])/);
    if (m) cols[Number(m[1])] = idx;
    else positional.push(idx);
  });
  const gearOrder = [4, 3, 2];
  positional.slice(0, 3).forEach((idx, i) => {
    const g = gearOrder[i];
    if (cols[g] === undefined) cols[g] = idx;
  });
  return cols;
}

module.exports = { normHeader, findIndex, findAllExact, zipToGearBlocks };
