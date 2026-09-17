// Day-count thresholds from the program's "DIET MAIL SCHEDULE" — 1st mail
// when a gear's prep window ends, 2nd (escalation) mail when the pending
// diet should have reached the TL. Both are relative to a person's own
// "Current Day" counter (already live in the sheet), not calendar dates.
const MAIL_SCHEDULE = {
  4: { label: 'Dinner', mail1Day: 23, mail2Day: 32 },
  3: { label: 'Lunch', mail1Day: 43, mail2Day: 52 },
  2: { label: 'Breakfast', mail1Day: 63, mail2Day: 72 },
};

// Returns { level: '1st'|'2nd', label } if this person+gear has crossed a
// mail threshold and isn't done yet, else null. "Done" for the 1st mail
// (prep reminder) means the gear has been prepared; for the 2nd (escalation
// to the TL) means it's already been TL-verified.
function mailReminder(person, gear) {
  const schedule = MAIL_SCHEDULE[gear];
  if (!schedule || typeof person.currentDay !== 'number') return null;

  const verified = person.gearTLVerified && person.gearTLVerified[gear];
  if (verified) return null;

  const prepared = person.gearReady && person.gearReady[gear];
  if (!prepared && person.currentDay >= schedule.mail1Day) {
    return { level: '1st', label: schedule.label };
  }
  if (prepared && person.currentDay >= schedule.mail2Day) {
    return { level: '2nd', label: schedule.label };
  }
  return null;
}

export { MAIL_SCHEDULE, mailReminder };
