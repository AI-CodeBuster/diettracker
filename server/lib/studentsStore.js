// Native in-app student registry (Register Student wizard, manual entry,
// CSV upload/download) — backed by the diet_students Supabase table. This is
// deliberately separate from the Google-Sheet-backed Tracker: it's the app's
// own store for entering, viewing and exporting student data going forward
// so day-to-day data entry no longer depends on an external sheet. See
// supabase/schema.sql for the table definition.
const { supabaseAdmin } = require('./supabaseAdmin');
const { parseCSV } = require('./csv');
const { findIndex } = require('./sheetColumns');

// Single source of truth for every field this store knows about: API key,
// DB column, CSV/label header, and the header regexes used both to build our
// OWN CSV export (so a re-upload round-trips perfectly) and to make a
// best-effort read of a legacy Google-Sheet CSV export's overlapping column
// names on "Upload Sheet" — same regex-AND convention as
// server/lib/sheetSchema.js uses for the live tracker sheets. Mirrored on
// the client in client/src/lib/studentFields.js (key names match 1:1) — keep
// both in sync if a field is ever added or renamed.
const FIELDS = [
  { key: 'studentId', col: 'student_id', label: 'Student ID', matchers: [/student/, /id/] },
  { key: 'name', col: 'name', label: 'Student Name', matchers: [/student/, /name/] },
  { key: 'contact', col: 'contact', label: 'Contact', matchers: [/contact/] },
  { key: 'gender', col: 'gender', label: 'Gender', matchers: [/gender/] },
  { key: 'age', col: 'age', label: 'Age', matchers: [/^age$/] },
  { key: 'batch', col: 'batch', label: 'Batch', matchers: [/batch/] },
  { key: 'hcName', col: 'hc_name', label: 'Health Coach', matchers: [/health coach/] },
  { key: 'tlName', col: 'tl_name', label: 'TL Name', matchers: [/^tl name$/] },
  { key: 'category', col: 'category', label: 'Category', matchers: [/^category$/] },
  { key: 'batchStatus', col: 'batch_status', label: 'Batch Status', matchers: [/batch/, /status/] },
  { key: 'courseStartDate', col: 'course_start_date', label: 'Course Start Date', matchers: [/course start date/] },
  { key: 'doh', col: 'doh', label: 'DOH', matchers: [/^doh$/] },
  { key: 'doe', col: 'doe', label: 'DOE', matchers: [/^doe/] },
  { key: 'daysSinceJoined', col: 'days_since_joined', label: 'Days Since Joined', matchers: [/days since joined/] },
  { key: 'totalHandover', col: 'total_handover', label: 'Total Handover', matchers: [/total handover/] },
  { key: 'currentDay', col: 'current_day', label: 'Current Day', matchers: [/^current day$/] },
  { key: 'introCallStatus', col: 'intro_call_status', label: 'Intro Call Status', matchers: [/intro call/] },
  { key: 'bloodReportDate', col: 'blood_report_date', label: 'Blood Report Date', matchers: [/blood report/, /date/] },
  { key: 'height', col: 'height', label: 'Height', matchers: [/height/] },
  { key: 'weight', col: 'weight', label: 'Weight', matchers: [/weight/] },
  { key: 'vegPreference', col: 'veg_preference', label: 'Diet Preference', matchers: [/diet preference/] },
  { key: 'language', col: 'language', label: 'Language', matchers: [/language/] },
  { key: 'conditionRaw', col: 'condition_raw', label: 'Medical Condition', matchers: [/medical condition/] },
  { key: 'secondaryCondition', col: 'secondary_condition', label: 'Secondary Condition', matchers: [/secondary/, /condition/] },
  { key: 'pastHistory', col: 'past_history', label: 'Past History', matchers: [/past\s*history/] },
  { key: 'foodAllergy', col: 'food_allergy', label: 'Food Allergy', matchers: [/food/, /allerg/] },
  { key: 'dislikeFood', col: 'dislike_food', label: 'Dislike Food', matchers: [/dislike/] },
  { key: 'supplement', col: 'supplement', label: 'Supplement', matchers: [/supplement/] },
  { key: 'gear2DietType', col: 'gear2_diet_type', label: 'Gear 2 Diet Type', matchers: [/gear\s*2/, /diet type/] },
  { key: 'gear3DietType', col: 'gear3_diet_type', label: 'Gear 3 Diet Type', matchers: [/gear\s*3/, /diet type/] },
  { key: 'gear4DietType', col: 'gear4_diet_type', label: 'Gear 4 Diet Type', matchers: [/gear\s*4/, /diet type/] },
];

function toApi(row) {
  const out = {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByName: row.created_by_name || '',
    updatedByName: row.updated_by_name || '',
  };
  FIELDS.forEach((f) => { out[f.key] = row[f.col] || ''; });
  return out;
}

// Only fields actually present in the payload are written — a PUT can send
// just the fields that changed without clobbering the rest back to blank.
function fromApi(payload) {
  const out = {};
  FIELDS.forEach((f) => {
    if (payload[f.key] === undefined) return;
    const v = typeof payload[f.key] === 'string' ? payload[f.key].trim() : payload[f.key];
    // An explicitly blank studentId must be OMITTED, not written as '': the
    // column's own sequence-backed default (see supabase/schema.sql) only
    // fires when the column is left out of the insert entirely, and writing
    // '' would collide across every other blank-ID row (unlike NULL, which
    // Postgres treats as distinct for the unique constraint).
    if (f.key === 'studentId' && !v) return;
    out[f.col] = v;
  });
  return out;
}

async function listStudents() {
  const { data, error } = await supabaseAdmin.from('diet_students').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(toApi);
}

async function createStudent(payload, actor) {
  if (!payload.name || !String(payload.name).trim()) throw new Error('Student name is required');
  const row = fromApi(payload);
  row.created_by_id = actor.id;
  row.created_by_name = actor.name;
  row.updated_by_name = actor.name;
  const { data, error } = await supabaseAdmin.from('diet_students').insert(row).select().single();
  if (error) throw error;
  return toApi(data);
}

async function updateStudent(id, payload, actor) {
  const row = fromApi(payload);
  if (Object.prototype.hasOwnProperty.call(row, 'name') && !row.name) throw new Error('Student name is required');
  row.updated_at = new Date().toISOString();
  row.updated_by_name = actor.name;
  const { data, error } = await supabaseAdmin.from('diet_students').update(row).eq('id', id).select().single();
  if (error) throw error;
  if (!data) throw new Error('Student not found');
  return toApi(data);
}

async function deleteStudent(id) {
  const { error } = await supabaseAdmin.from('diet_students').delete().eq('id', id);
  if (error) throw error;
}

function exportHeaders() {
  return FIELDS.map((f) => f.label);
}

function exportRows(students) {
  return students.map((s) => FIELDS.map((f) => s[f.key] || ''));
}

// Matches a CSV's header row against FIELDS by regex, same convention as
// sheetSchema.js's own column detection — works equally well against our own
// exported headers (exact label match) and a legacy sheet export's looser
// column names.
function matchColumns(headers) {
  const idxByKey = {};
  FIELDS.forEach((f) => {
    const idx = findIndex(headers, f.matchers);
    if (idx >= 0) idxByKey[f.key] = idx;
  });
  const matchedIdxs = new Set(Object.values(idxByKey));
  const unmatchedHeaders = headers.filter((h, i) => h && h.trim() && !matchedIdxs.has(i)).map((h) => h.trim());
  return { idxByKey, unmatchedHeaders };
}

// Bulk import: every row is normalized to carry EVERY column (missing values
// become null) before the batch upsert, since PostgREST builds one INSERT
// statement from the batch and expects a consistent column set across rows —
// a batch with some objects missing a key and others not is exactly the case
// that trips it up. Upserting on student_id means a row naming an EXISTING
// student_id updates that record; a row with no student_id (or a new one)
// always inserts fresh — Postgres treats NULLs as distinct for the unique
// constraint, so multiple blank-ID rows never collide with each other. This
// never deletes anything, so re-uploading the same file twice is always safe.
async function bulkImportStudents(csvText, actor) {
  const table = parseCSV(csvText);
  if (!table.length) throw new Error('The file is empty');
  const headers = table[0];
  const dataRows = table.slice(1);
  const { idxByKey, unmatchedHeaders } = matchColumns(headers);
  if (idxByKey.name === undefined) {
    throw new Error('Could not find a "Student Name" column in this file — check the header row');
  }

  const nowIso = new Date().toISOString();
  const rows = [];
  const skipped = [];
  dataRows.forEach((row, i) => {
    if (!row.some((v) => v && v.trim())) return; // fully blank row
    const name = (row[idxByKey.name] || '').trim();
    if (!name) { skipped.push({ row: i + 2, reason: 'Missing student name' }); return; }
    const dbRow = {};
    FIELDS.forEach((f) => {
      const idx = idxByKey[f.key];
      const v = idx === undefined ? '' : (row[idx] || '').trim();
      dbRow[f.col] = v || null;
    });
    dbRow.name = name;
    dbRow.updated_at = nowIso;
    dbRow.updated_by_name = actor.name;
    dbRow.created_by_id = actor.id;
    dbRow.created_by_name = actor.name;
    rows.push(dbRow);
  });

  if (!rows.length) return { imported: 0, totalRows: dataRows.length, skipped, unmatchedHeaders };

  const { error } = await supabaseAdmin.from('diet_students').upsert(rows, { onConflict: 'student_id' });
  if (error) throw error;

  return { imported: rows.length, totalRows: dataRows.length, skipped, unmatchedHeaders };
}

module.exports = {
  FIELDS,
  listStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  exportHeaders,
  exportRows,
  bulkImportStudents,
};
