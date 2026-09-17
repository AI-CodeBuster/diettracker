// Merges every source of "what happened to this person, when, and who did
// it" into one chronological feed for the profile page's Activity Timeline —
// combining the effort log (Mark Prepared / TL Verify actions), the manual
// status checkpoints (Call Done / Completed), and weight snapshots. None of
// these lived in one place before; the sheet itself has no activity history
// at all, only current-state columns.
const { supabaseAdmin } = require('./supabaseAdmin');

async function listPatientActivity(personKey, limit = 30) {
  const [effortRes, statusRes, weightRes] = await Promise.all([
    supabaseAdmin
      .from('diet_effort_log')
      .select('gear, action, performed_by_name, performed_at')
      .eq('person_key', personKey)
      .order('performed_at', { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from('diet_patient_status')
      .select('gear, status, updated_by_name, updated_at')
      .eq('person_key', personKey),
    supabaseAdmin
      .from('diet_patient_weight_log')
      .select('weight_kg, recorded_at')
      .eq('person_key', personKey)
      .order('recorded_at', { ascending: false })
      .limit(limit),
  ]);
  if (effortRes.error) throw effortRes.error;
  if (statusRes.error) throw statusRes.error;
  if (weightRes.error) throw weightRes.error;

  const events = [];

  (effortRes.data || []).forEach((row) => {
    events.push({
      type: row.action, // 'prepared' | 'verified'
      gear: row.gear,
      at: row.performed_at,
      byName: row.performed_by_name,
    });
  });

  (statusRes.data || []).forEach((row) => {
    events.push({
      type: row.status, // 'call_done' | 'completed'
      gear: row.gear,
      at: row.updated_at,
      byName: row.updated_by_name,
    });
  });

  (weightRes.data || []).forEach((row) => {
    events.push({
      type: 'weight',
      at: row.recorded_at,
      detail: `${row.weight_kg}kg`,
    });
  });

  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return events.slice(0, limit);
}

module.exports = { listPatientActivity };
