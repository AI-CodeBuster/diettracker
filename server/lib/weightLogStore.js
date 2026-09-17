// Weight history, backed by the diet_patient_weight_log Supabase table. The
// sheet only ever has a person's current weight, so the server appends a
// snapshot here whenever a sync sees a changed value — that's what lets the
// profile page show a gain/loss trend instead of just the latest number.
const { supabaseAdmin } = require('./supabaseAdmin');

async function recordWeightIfChanged(personKey, weightKg) {
  const { data: last, error: readError } = await supabaseAdmin
    .from('diet_patient_weight_log')
    .select('weight_kg')
    .eq('person_key', personKey)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) throw readError;
  if (last && Number(last.weight_kg) === Number(weightKg)) return; // unchanged — dedup

  const { error: insertError } = await supabaseAdmin
    .from('diet_patient_weight_log')
    .insert({ person_key: personKey, weight_kg: weightKg });
  if (insertError) throw insertError;
}

async function listWeightHistory(personKey, limit = 20) {
  const { data, error } = await supabaseAdmin
    .from('diet_patient_weight_log')
    .select('weight_kg, recorded_at')
    .eq('person_key', personKey)
    .order('recorded_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((row) => ({ weightKg: row.weight_kg, recordedAt: row.recorded_at }));
}

module.exports = { recordWeightIfChanged, listWeightHistory };
