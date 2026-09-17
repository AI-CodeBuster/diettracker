// Display copy for /api/patient-activity events (see
// server/lib/patientActivityStore.js for what feeds into it).
const ACTIVITY_LABELS = {
  prepared: (e) => `Gear ${e.gear} marked Prepared${e.byName ? ` by ${e.byName}` : ''}`,
  verified: (e) => `Gear ${e.gear} TL Verified${e.byName ? ` by ${e.byName}` : ''}`,
  call_done: (e) => `Gear ${e.gear} Call Done${e.byName ? ` by ${e.byName}` : ''}`,
  completed: (e) => `Gear ${e.gear} marked Completed${e.byName ? ` by ${e.byName}` : ''}`,
  weight: (e) => `Weight recorded: ${e.detail}`,
};

const ACTIVITY_ICON = {
  prepared: '📝',
  verified: '✓',
  call_done: '📞',
  completed: '🏁',
  weight: '⚖',
};

function activityLabel(event) {
  const fn = ACTIVITY_LABELS[event.type];
  return fn ? fn(event) : event.type;
}

function activityIcon(event) {
  return ACTIVITY_ICON[event.type] || '•';
}

export { activityLabel, activityIcon };
