// Diet Preparation % / Diet Verification % — the program's own formulas
// (see the tracker's "DIET PREPARATION %" / "DIET VERIFICATION %" reference).
// "On time" can only be known from the effort log's "Mark Prepared"
// timestamp compared against the gear's Due Date — there's no such
// timestamp for anything prepared before that feature existed, so those
// diets simply can't count toward "on time" either way (this fades in as
// the team actually uses Mark Prepared, never guessed at).
import { parseSheetDate } from './dates';

function preparedOnTime(person, gear, preparedAtMap, personKey) {
  const preparedAt = preparedAtMap[`${personKey}:${gear}`];
  if (!preparedAt) return false;
  const due = person.gearDates && person.gearDates[gear] && parseSheetDate(person.gearDates[gear].due);
  if (!due) return false;
  return new Date(preparedAt) <= due;
}

// entries: [{ sheetName, person, key }] — same shape Dashboard already
// builds from useAllPeople. preparedAtMap: personKey:gear -> ISO timestamp
// (from GET /api/effort-log/prepared-times).
function computeTeamPerformance(entries, preparedAtMap) {
  const gears = [2, 3, 4];
  const result = {};

  gears.forEach((gear) => {
    let prepEligible = 0;
    let prepOnTime = 0;
    let verifyEligible = 0;
    let verifyDone = 0;

    entries.forEach(({ person, key }) => {
      const onTime = preparedOnTime(person, gear, preparedAtMap, key);

      // Diet Preparation %: Gear 4 is eligible once the intro call
      // connected; Gear 3/2 are eligible once that gear's own blood report
      // came back — matching the two different formulas verbatim.
      const eligible = gear === 4
        ? (person.introCallStatus || '').trim().toLowerCase() === 'done'
        : (person.gearBloodStatus && person.gearBloodStatus[gear]) === 'done';
      if (eligible) {
        prepEligible += 1;
        if (onTime) prepOnTime += 1;
      }

      // Diet Verification %: denominator is diets prepared on time (not
      // just prepared), numerator adds TL-verified on top of that.
      if (onTime) {
        verifyEligible += 1;
        if (person.gearTLVerified && person.gearTLVerified[gear]) verifyDone += 1;
      }
    });

    result[gear] = {
      preparation: { eligible: prepEligible, onTime: prepOnTime, pct: prepEligible ? Math.round((prepOnTime / prepEligible) * 100) : null },
      verification: { eligible: verifyEligible, done: verifyDone, pct: verifyEligible ? Math.round((verifyDone / verifyEligible) * 100) : null },
    };
  });

  return result;
}

export { computeTeamPerformance };
