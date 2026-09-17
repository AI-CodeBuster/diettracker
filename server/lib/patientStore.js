// Per-patient store for saved gear-diet replacements (dislike/allergy swaps
// a coach made for one specific patient), backed by the diet_patient_overrides
// Supabase table. The shared diet-plan .docx templates in Supabase Storage
// are never modified — this only stores small JSON "override" rows, applied
// as an overlay on top of the shared template when that patient's gear is
// viewed again.
const { supabaseAdmin } = require('./supabaseAdmin');

// Matches the client's client/src/lib/patientKey.js — keep both in sync.
const SAFE_KEY_RE = /^[A-Za-z0-9_.-]+$/;

function isSafeKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length < 200 && SAFE_KEY_RE.test(key);
}

async function readOverrides(key) {
  const { data, error } = await supabaseAdmin
    .from('diet_patient_overrides')
    .select('gear, manifest_id, replacements')
    .eq('person_key', key);
  if (error) throw error;
  const gears = {};
  for (const row of data || []) {
    gears[String(row.gear)] = { manifestId: row.manifest_id, replacements: row.replacements || [] };
  }
  return { personKey: key, gears };
}

async function writeGearOverride(key, gear, { manifestId, replacements }) {
  if (!/^\d+$/.test(String(gear))) throw new Error(`Invalid gear: ${gear}`);
  const { error } = await supabaseAdmin.from('diet_patient_overrides').upsert(
    {
      person_key: key,
      gear: Number(gear),
      manifest_id: manifestId,
      replacements: replacements || [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'person_key,gear' }
  );
  if (error) throw error;
  return readOverrides(key);
}

module.exports = { readOverrides, writeGearOverride, isSafeKey };
