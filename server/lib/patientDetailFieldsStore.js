// Global (not per-patient) config: which fields render on EVERY diet plan's
// cover page (client/src/components/PatientCoverPage.jsx), split into the
// same three tables that component and the source management document use
// -- Personal Details / Diet & Other Preference / Clinical Details. See
// supabase/schema.sql's diet_patient_detail_fields (a singleton row, id
// always 1) and the "Patient Details Edit" sidebar page that edits it.
const { supabaseAdmin } = require('./supabaseAdmin');

// The full catalog of fields this feature can show/hide per category, in
// their DEFAULT display order -- PatientCoverPage.jsx owns the actual
// label/value for each key; this is just which keys are valid per category,
// which Postgres column their order is saved under, and what ships before
// any TL/developer has ever saved a custom selection for that category.
const FIELD_CATALOG = {
  personal: {
    column: 'field_keys',
    allKeys: ['name', 'studentId', 'batch', 'hcName', 'gender', 'contact', 'age', 'height', 'weight', 'bmi', 'ibw'],
    defaultKeys: ['name', 'batch', 'age', 'height', 'weight', 'bmi', 'ibw'],
  },
  dietPreference: {
    column: 'diet_preference_field_keys',
    allKeys: ['dietName', 'preparedBy', 'dietaryChoice', 'supplement', 'foodAllergies', 'foodDislikes'],
    defaultKeys: ['dietName', 'preparedBy', 'dietaryChoice', 'supplement', 'foodAllergies', 'foodDislikes'],
  },
  clinicalDetails: {
    column: 'clinical_detail_field_keys',
    allKeys: ['primaryCondition', 'secondaryCondition', 'pastHistory', 'bloodReportFindings'],
    defaultKeys: ['primaryCondition', 'secondaryCondition', 'pastHistory', 'bloodReportFindings'],
  },
};
const CATEGORY_KEYS = Object.keys(FIELD_CATALOG);
const ALL_FIELD_KEYS = Object.fromEntries(CATEGORY_KEYS.map((c) => [c, FIELD_CATALOG[c].allKeys]));
const SELECT_COLUMNS = CATEGORY_KEYS.map((c) => FIELD_CATALOG[c].column).join(', ');

async function getPatientDetailFields() {
  const { data, error } = await supabaseAdmin
    .from('diet_patient_detail_fields')
    .select(SELECT_COLUMNS)
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  const result = {};
  for (const category of CATEGORY_KEYS) {
    const { column, defaultKeys } = FIELD_CATALOG[category];
    const saved = data && data[column];
    result[category] = (saved && saved.length) ? saved : defaultKeys;
  }
  return result;
}

async function savePatientDetailFields(fields, updatedByName) {
  const row = { id: 1, updated_at: new Date().toISOString(), updated_by_name: updatedByName };
  for (const category of CATEGORY_KEYS) {
    row[FIELD_CATALOG[category].column] = fields[category];
  }
  const { data, error } = await supabaseAdmin
    .from('diet_patient_detail_fields')
    .upsert(row)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  const result = {};
  for (const category of CATEGORY_KEYS) {
    result[category] = data[FIELD_CATALOG[category].column];
  }
  return result;
}

module.exports = { getPatientDetailFields, savePatientDetailFields, ALL_FIELD_KEYS, CATEGORY_KEYS };
