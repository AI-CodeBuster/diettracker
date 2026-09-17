// Display labels for diet_requirements rows — separate status set from
// issueLabels.js since a requirement's lifecycle (proposed -> in progress ->
// done/declined) isn't the same as a bug's (open -> in progress -> fixed/won't do).

const STATUS_LABELS = {
  proposed: 'Proposed',
  in_progress: 'In Progress',
  done: 'Done',
  declined: 'Declined',
};

const STATUS_ORDER = ['proposed', 'in_progress', 'done', 'declined'];

const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function priorityLabel(priority) {
  return PRIORITY_LABELS[priority] || priority;
}

export { STATUS_LABELS, STATUS_ORDER, PRIORITY_LABELS, statusLabel, priorityLabel };
