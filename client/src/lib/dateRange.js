// Date-range quick filters for the recipe Library's "Added" column —
// yesterday / last 7 / 15 / 30 days, evaluated against a recipe's addedAt
// (ISO timestamp — diet_manual_recipes.created_at, see server/lib/
// manualRecipeStore.js). A recipe with no addedAt (every recipe-library.json
// entry migrated before this feature existed) never matches any range but
// "Any time" — there's nothing recorded to compare against.
export const DATE_RANGE_OPTIONS = [
  { key: 'all', label: 'Any time' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '15d', label: 'Last 15 days' },
  { key: '30d', label: 'Last 1 month' },
];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function matchesDateRange(isoString, rangeKey) {
  if (!rangeKey || rangeKey === 'all') return true;
  if (!isoString) return false;
  const added = new Date(isoString);
  const now = new Date();
  if (rangeKey === 'yesterday') {
    const yesterdayStart = startOfDay(now);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    return added >= yesterdayStart && added < startOfDay(now);
  }
  const days = { '7d': 7, '15d': 15, '30d': 30 }[rangeKey];
  if (!days) return true;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return added >= cutoff;
}

export function formatAddedAt(isoString) {
  if (!isoString) return 'Not recorded';
  const d = new Date(isoString);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
