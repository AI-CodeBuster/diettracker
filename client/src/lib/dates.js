// Parses the two date formats actually seen in the tracker sheet
// ("23-Jun-2026" and "1 June 2026" — dash- vs space-separated, abbreviated
// vs full month name, same day-month-year order) and computes a per-gear
// "days left" status from a gear's Expected/Due/Actual date triple.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseSheetDate(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  const year = Number(m[3]);
  if (month === undefined || !day || !year) return null;
  const d = new Date(year, month, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * @param {{ expected?: string, due?: string, actual?: string }} gearDate
 * @returns {null | { status: 'done', doneOn: Date } | { status: 'overdue'|'upcoming', days: number, due: Date }}
 */
function daysLeft(gearDate) {
  if (!gearDate) return null;
  if (gearDate.actual && gearDate.actual.trim()) {
    const doneOn = parseSheetDate(gearDate.actual);
    return { status: 'done', doneOn };
  }
  const due = parseSheetDate(gearDate.due);
  if (!due) return null;
  const diffMs = due.getTime() - startOfToday().getTime();
  const days = Math.round(diffMs / 86_400_000);
  return { status: days < 0 ? 'overdue' : 'upcoming', days: Math.abs(days), due };
}

export { parseSheetDate, daysLeft };
