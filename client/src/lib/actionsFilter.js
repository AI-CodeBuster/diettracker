// Actions-column status dropdown filter (PersonTable's "Actions" header) --
// same header-select pattern as the existing Batch/Health Coach filters,
// just keyed on gear status instead. Unifies gearStatus.js's Pending/Call
// Done/Prepared/Verified/Completed lifecycle with gearBlock.js's blocked-
// state labels (Blood report not provided/Waiting for approval/Yet to be
// Prepared/Diet plan not prepared yet) into one filterable value per
// person+gear -- exactly what that gear's chip in PersonTable already
// shows, so picking a filter value always matches what's visibly on
// screen. Purely additive: does not change gearStatus.js or gearBlock.js.
import { deriveGearStatus } from './gearStatus';
import { gearBlockReason } from './gearBlock';

const ACTIONS_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'call_done', label: 'Call Done' },
  { value: 'prepared', label: 'Prepared' },
  { value: 'verified', label: 'Verified' },
  { value: 'completed', label: 'Completed' },
  { value: 'yet_to_be_prepared', label: 'Yet to be Prepared' },
  { value: 'not_prepared_yet', label: 'Diet Plan Not Prepared Yet' },
  { value: 'blood_not_provided', label: 'Blood Report Not Provided' },
  { value: 'waiting_approval', label: 'Waiting for Approval' },
];

// Checked in order so a longer, more specific label ('Yet to be Prepared')
// is matched before a shorter one that could otherwise collide.
const BLOCK_KEY_BY_LABEL_PREFIX = [
  { prefix: 'Yet to be Prepared', key: 'yet_to_be_prepared' },
  { prefix: 'Blood report not provided', key: 'blood_not_provided' },
  { prefix: 'Waiting for approval', key: 'waiting_approval' },
  { prefix: 'Diet plan not prepared yet', key: 'not_prepared_yet' },
];

function effectiveActionsState(person, gear, manualStatus) {
  const blockReason = gearBlockReason(person, gear);
  if (blockReason) {
    const match = BLOCK_KEY_BY_LABEL_PREFIX.find(({ prefix }) => blockReason.label.startsWith(prefix));
    if (match) return match.key;
  }
  return deriveGearStatus(person, gear, manualStatus);
}

function matchesActionsFilter(state, filter) {
  if (filter === 'all') return true;
  if (filter === 'unverified') return state !== 'verified' && state !== 'completed';
  return state === filter;
}

export { ACTIONS_FILTER_OPTIONS, effectiveActionsState, matchesActionsFilter };
