// Display labels/CSS classes for the gear status lifecycle (see
// lib/gearStatus.js), mirroring lib/issueLabels.js's STATUS_LABELS/
// STATUS_ORDER/statusLabel shape so both status systems look and behave the
// same way in the UI.
import { timeAgo } from './issueLabels';

const STATUS_LABELS = {
  pending: 'Pending',
  call_done: 'Call Done',
  prepared: 'Prepared',
  verified: 'Verified',
  completed: 'Completed',
};

const STATUS_ORDER = ['pending', 'call_done', 'prepared', 'verified', 'completed'];

// One CSS class per status, defined in App.css alongside the existing
// .issue-status-* pills.
const STATUS_CLASS = {
  pending: 'gear-status-pending',
  call_done: 'gear-status-call-done',
  prepared: 'gear-status-prepared',
  verified: 'gear-status-verified',
  completed: 'gear-status-completed',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function statusClass(status) {
  return STATUS_CLASS[status] || '';
}

export { STATUS_LABELS, STATUS_ORDER, statusLabel, statusClass, timeAgo };
