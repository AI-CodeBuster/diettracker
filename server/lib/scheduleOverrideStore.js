// Per-patient store for Diet Schedule table-cell edits made in the new
// data-driven diet viewer (DietTemplateView's MealPlanTable/InfoTable),
// backed by the diet_schedule_overrides Supabase table — same
// shape/convention as recipeOverrideStore.js's diet_recipe_overrides, but
// keyed positionally ({ tableKey, rowIndex, colIndex, value }) rather than
// by recipe_id, since a schedule row has no recipe identity to key against.
const { supabaseAdmin } = require('./supabaseAdmin');

async function readScheduleOverrides(key) {
  const { data, error } = await supabaseAdmin
    .from('diet_schedule_overrides')
    .select('gear, overrides')
    .eq('person_key', key);
  if (error) throw error;
  const gears = {};
  for (const row of data || []) {
    gears[String(row.gear)] = row.overrides || [];
  }
  return { personKey: key, gears };
}

async function writeScheduleOverride(key, gear, overrides) {
  if (!/^\d+$/.test(String(gear))) throw new Error(`Invalid gear: ${gear}`);
  const { error } = await supabaseAdmin.from('diet_schedule_overrides').upsert(
    {
      person_key: key,
      gear: Number(gear),
      overrides: overrides || [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'person_key,gear' }
  );
  if (error) throw error;
  return readScheduleOverrides(key);
}

module.exports = { readScheduleOverrides, writeScheduleOverride };
