// Manually-set lifecycle checkpoints (Call Done, Completed) that no sheet
// column tracks, backed by the diet_patient_status Supabase table. Pending/
// Prepared/Verified are derived live from sheet data instead (see
// client/src/lib/gearStatus.js) and never stored here — see
// supabase/schema.sql for the full status-lifecycle rationale.
const { supabaseAdmin } = require('./supabaseAdmin');

const STATUSES = new Set(['call_done', 'completed']);

function toApi(row) {
  return {
    personKey: row.person_key,
    gear: row.gear,
    status: row.status,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name,
  };
}

async function listAllStatuses() {
  const { data, error } = await supabaseAdmin.from('diet_patient_status').select('*');
  if (error) throw error;
  return (data || []).map(toApi);
}

async function getStatusesForPerson(personKey) {
  const { data, error } = await supabaseAdmin
    .from('diet_patient_status')
    .select('*')
    .eq('person_key', personKey);
  if (error) throw error;
  return (data || []).map(toApi);
}

async function setStatus(personKey, gear, status, updatedByName) {
  if (!STATUSES.has(status)) throw new Error(`Invalid status: ${status}`);
  const { data, error } = await supabaseAdmin
    .from('diet_patient_status')
    .upsert(
      { person_key: personKey, gear: Number(gear), status, updated_at: new Date().toISOString(), updated_by_name: updatedByName },
      { onConflict: 'person_key,gear' }
    )
    .select()
    .single();
  if (error) throw error;
  return toApi(data);
}

async function clearStatus(personKey, gear) {
  const { error } = await supabaseAdmin
    .from('diet_patient_status')
    .delete()
    .eq('person_key', personKey)
    .eq('gear', Number(gear));
  if (error) throw error;
}

module.exports = { listAllStatuses, getStatusesForPerson, setStatus, clearStatus, STATUSES };
