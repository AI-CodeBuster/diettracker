// Per-patient store for saved recipe replacements made in the NEW
// data-driven diet viewer (DietTemplateView), backed by the
// diet_recipe_overrides Supabase table — same shape/convention as
// patientStore.js's diet_patient_overrides, but deliberately a separate
// table: that one stores TEXT splices ({ originalText, replacementText })
// for the old .docx-splice pipeline, whereas this stores an ID swap
// ({ originalRecipeId, newRecipeId }) against the recipe library. Keeping
// them apart means the two replacement systems — old document-splice,
// new structured-data swap — can never be confused with one another.
const { supabaseAdmin } = require('./supabaseAdmin');

async function readRecipeOverrides(key) {
  const { data, error } = await supabaseAdmin
    .from('diet_recipe_overrides')
    .select('gear, overrides')
    .eq('person_key', key);
  if (error) throw error;
  const gears = {};
  for (const row of data || []) {
    gears[String(row.gear)] = row.overrides || [];
  }
  return { personKey: key, gears };
}

async function writeRecipeOverride(key, gear, overrides) {
  if (!/^\d+$/.test(String(gear))) throw new Error(`Invalid gear: ${gear}`);
  const { error } = await supabaseAdmin.from('diet_recipe_overrides').upsert(
    {
      person_key: key,
      gear: Number(gear),
      overrides: overrides || [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'person_key,gear' }
  );
  if (error) throw error;
  return readRecipeOverrides(key);
}

module.exports = { readRecipeOverrides, writeRecipeOverride };
