import { daysLeft } from './dates';
import { GATED_GEARS } from './gearStatus';

function gearDueBadge(person, gear) {
  const status = daysLeft(person.gearDates && person.gearDates[gear]);
  if (!status) return null;
  if (status.status === 'done') return { text: 'Done', className: 'gear-due-done' };
  if (status.status === 'overdue') return { text: `Overdue ${status.days}d`, className: 'gear-due-overdue' };
  return { text: `${status.days}d left`, className: 'gear-due-upcoming' };
}

// Two independent checkpoints can each block a Gear 2/3 button — Gear 4
// always opens for every patient, gated on neither. Checked in this order:
//   1. gearBloodStatus — that gear's own blood report has been reviewed.
//      Only 'done' clears it; 'pending' and 'not_provided' (a blank cell
//      or an explicit "NA") block it. Checked first: a missing or
//      unreviewed blood report blocks the gear no matter what the prep
//      status below says, so "Blood report not provided" always wins over
//      "Diet plan not prepared yet".
//   2. gearReady — only reached once blood clears. That gear's own diet
//      plan has actually been prepared ("Gear N Preparation status" is
//      Done) — a blood-cleared gear can still have nothing written up yet.
// A gear whose sheet has no column for a given check at all (key absent
// from gearBloodStatus / gearReady) isn't gated on that check — nothing to
// gate on.
// GATED_GEARS itself lives in gearStatus.js — deriveGearStatus() needs the
// exact same blood-then-prep rule to keep the status chip from ever
// showing "Prepared" while this button is still blocked, so both places
// share one definition instead of risking drift.
const BLOOD_BLOCK_LABELS = {
  pending: 'Waiting for approval',
  not_provided: 'Blood report not provided',
};

const BLOOD_BLOCK_HINTS = {
  pending: "this gear's blood report is entered but not approved yet",
  not_provided: "this gear's blood report hasn't been provided",
};

// A later gear (3 or 4) already being prepared is proof this person's Gear
// 2 blood-block reading is stale — their blood work clearly happened at
// some point, the sheet's Gear 2 columns just haven't caught up. Showing
// "Blood report not provided" in that case reads as flatly wrong to a coach
// looking at the record, so it's replaced with a plainer "not started yet"
// message instead (stakeholder feedback: Gear 2 status clarification).
function laterGearAlreadyPrepared(person, gear) {
  return [3, 4].some((g) => g > gear && person.gearReady && person.gearReady[g]);
}

function gearBlockReason(person, gear) {
  if (!GATED_GEARS.has(gear)) return null;

  const bloodStatus = person.gearBloodStatus && person.gearBloodStatus[gear];
  if (BLOOD_BLOCK_LABELS[bloodStatus]) {
    if (gear === 2 && laterGearAlreadyPrepared(person, gear)) {
      const startDate = person.gearDates && person.gearDates[gear] && person.gearDates[gear].expected;
      return {
        label: startDate ? `Yet to be Prepared (started ${startDate})` : 'Yet to be Prepared',
        hint: 'a later gear is already prepared, so this is just not started yet — not a missing blood report',
      };
    }
    return { label: BLOOD_BLOCK_LABELS[bloodStatus], hint: BLOOD_BLOCK_HINTS[bloodStatus] };
  }

  const ready = person.gearReady && person.gearReady[gear];
  if (ready === false) {
    return {
      label: 'Diet plan not prepared yet',
      hint: "blood report is cleared, but this gear's diet plan hasn't been prepared yet",
    };
  }

  return null;
}

export { gearDueBadge, gearBlockReason };
