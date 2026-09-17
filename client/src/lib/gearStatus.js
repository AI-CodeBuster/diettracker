// The single source of truth for a gear's Pending/Call Done/Prepared/
// Verified/Completed lifecycle. Pending/Prepared/Verified are derived live
// from sheet-sourced fields already on the person object; Call Done and
// Completed come from the manually-set diet_patient_status row (there's no
// sheet column for either — see supabase/schema.sql). A manual mark never
// gets overridden by what the sheet says (rank only ever goes up here), so
// "Completed" stays sticky even if the sheet's own columns still read
// "Pending".
const RANK = { pending: 0, call_done: 1, prepared: 2, verified: 3, completed: 4 };
const ORDER = ['pending', 'call_done', 'prepared', 'verified', 'completed'];

// Same rule gearBlock.js's gearBlockReason() gates the Gear button on: Gear 2
// and 3 can't be "Prepared" (or beyond) until that gear's own blood report
// is reviewed — blank/"NA" and any non-"done" value both count as not
// provided (see classifyBloodStatus in server/lib/sheetSchema.js). Gear 4
// is never blood-gated. Checking blood first, then prep status, keeps the
// status chip from ever claiming "Prepared" while the Gear button right
// next to it is still showing "Blood report not provided".
const GATED_GEARS = new Set([2, 3]);

// A sheet layout with no blood-verification column at all for this gear
// (key absent from gearBloodStatus) isn't gated on it — same "nothing to
// gate on" rule gearBlockReason() uses. Only an explicit 'pending' or
// 'not_provided' value blocks; 'done' or a missing key both clear it.
function bloodCleared(person, gear) {
  if (!GATED_GEARS.has(gear)) return true;
  const status = person.gearBloodStatus && person.gearBloodStatus[gear];
  return status === undefined || status === 'done';
}

function deriveGearStatus(person, gear, manualStatus) {
  let rank = manualStatus === 'call_done' ? RANK.call_done : RANK.pending;
  if (bloodCleared(person, gear)) {
    if (person.gearReady && person.gearReady[gear]) rank = Math.max(rank, RANK.prepared);
    if (person.gearTLVerified && person.gearTLVerified[gear]) rank = Math.max(rank, RANK.verified);
  }
  if (manualStatus === 'completed') rank = RANK.completed;
  return ORDER[rank];
}

// Builds a `${personKey}:${gear}` -> row lookup from the bulk
// /api/patient-status response, for cheap repeated lookups while rendering
// a list. Callers read `.status` for deriveGearStatus and `.updatedAt` /
// `.updatedByName` for last-updated display.
function indexStatuses(statuses) {
  const map = new Map();
  (statuses || []).forEach((row) => map.set(`${row.personKey}:${row.gear}`, row));
  return map;
}

// "Unverified" is a grouping, not a lifecycle status: it is every gear that
// has not reached TL verification yet (Pending / Call Done / Prepared). It
// deliberately stays out of ORDER — the Dashboard tiles and the status
// pills both iterate that as the real lifecycle — and is applied as a
// filter value alongside 'all' instead.
//
// Completed outranks Verified, so a manually-completed gear counts as
// verified here even if a TL never signed it off: completion is an explicit
// terminal sign-off, and listing those rows under "still needs verifying"
// would just be noise.
function isUnverified(status) {
  return RANK[status] < RANK.verified;
}

// Shared by App.jsx (which rows survive the filter) and StatusFilter.jsx
// (the count shown on each pill) so the two cannot drift apart.
function matchesGearFilter(status, filter) {
  if (filter === 'all') return true;
  if (filter === 'unverified') return isUnverified(status);
  return status === filter;
}

export { RANK, ORDER, GATED_GEARS, bloodCleared, deriveGearStatus, isUnverified, matchesGearFilter, indexStatuses };
