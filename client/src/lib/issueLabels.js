// Display labels/colors for diet_issues rows, shared between the issues list,
// board, and raise-issue form so a status/urgency only needs a name in one place.

const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In Progress',
  fixed: 'Fixed',
  wont_do: "Won't Do",
};

const STATUS_ORDER = ['open', 'in_progress', 'fixed', 'wont_do'];

const URGENCY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

const KIND_LABELS = {
  bug: 'Bug',
  enhancement: 'Enhancement',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function urgencyLabel(urgency) {
  return URGENCY_LABELS[urgency] || urgency;
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || kind;
}

// Coarse day/hour/minute buckets rather than a full date library — issue
// timestamps only ever need to read like "2d ago" in the list, not a precise
// duration.
function timeAgo(isoString) {
  if (!isoString) return '';
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export { STATUS_LABELS, STATUS_ORDER, URGENCY_LABELS, KIND_LABELS, statusLabel, urgencyLabel, kindLabel, timeAgo };
