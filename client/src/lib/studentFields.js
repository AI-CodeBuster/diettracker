// Field catalog for the native Register Student module — key names mirror
// server/lib/studentsStore.js's FIELDS list 1:1 (same "mirror, keep in sync"
// convention this codebase already uses for bmi.js/conditionMatch.js) so the
// wizard, the table and CSV export/import can never drift apart.

export const STUDENT_FORM_STEPS = [
  {
    title: 'Basic Details',
    fields: [
      { key: 'name', label: 'Student Name', type: 'text', required: true, placeholder: 'e.g. Priya Ramesh' },
      { key: 'studentId', label: 'Student ID', type: 'text', placeholder: 'Leave blank to auto-generate' },
      { key: 'gender', label: 'Gender', type: 'select', options: ['', 'Male', 'Female', 'Other'] },
      { key: 'age', label: 'Age', type: 'text', placeholder: 'e.g. 34' },
      { key: 'contact', label: 'Contact Number', type: 'text', placeholder: 'e.g. 98765 43210' },
    ],
  },
  {
    title: 'Batch & Coach',
    fields: [
      { key: 'batch', label: 'Batch', type: 'text' },
      { key: 'hcName', label: 'Health Coach', type: 'text' },
      { key: 'tlName', label: 'TL Name', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'batchStatus', label: 'Batch Status', type: 'text' },
      { key: 'courseStartDate', label: 'Course Start Date', type: 'text', placeholder: 'e.g. 12-Jan-2026' },
      { key: 'doh', label: 'DOH', type: 'text', placeholder: 'e.g. 12-Jan-2026' },
      { key: 'doe', label: 'DOE', type: 'text', placeholder: 'e.g. 12-Jan-2026' },
      { key: 'introCallStatus', label: 'Intro Call Status', type: 'text' },
    ],
  },
  {
    title: 'Physical & Vitals',
    fields: [
      { key: 'height', label: 'Height', type: 'text', placeholder: 'e.g. 165 cm' },
      { key: 'weight', label: 'Weight', type: 'text', placeholder: 'e.g. 68 kg' },
      { key: 'bloodReportDate', label: 'Blood Report Date', type: 'text', placeholder: 'e.g. 12-Jan-2026' },
      { key: 'currentDay', label: 'Current Day', type: 'text', placeholder: 'e.g. 12' },
      { key: 'totalHandover', label: 'Total Handover', type: 'text' },
      { key: 'daysSinceJoined', label: 'Days Since Joined', type: 'text' },
    ],
  },
  {
    title: 'Diet Preference',
    fields: [
      { key: 'vegPreference', label: 'Diet Preference', type: 'select', options: ['', 'VEG', 'NONVEG', 'EGG'] },
      { key: 'language', label: 'Language', type: 'select', options: ['', 'ENG', 'TAM'] },
      { key: 'gear2DietType', label: 'Gear 2 Diet Type', type: 'select', options: ['', 'VEG', 'NONVEG', 'EGG'] },
      { key: 'gear3DietType', label: 'Gear 3 Diet Type', type: 'select', options: ['', 'VEG', 'NONVEG', 'EGG'] },
      { key: 'gear4DietType', label: 'Gear 4 Diet Type', type: 'select', options: ['', 'VEG', 'NONVEG', 'EGG'] },
    ],
  },
  {
    title: 'Medical & Clinical Details',
    fields: [
      { key: 'conditionRaw', label: 'Medical Condition(s)', type: 'textarea', placeholder: 'e.g. Type 2 Diabetes, Hypertension' },
      { key: 'secondaryCondition', label: 'Secondary Condition', type: 'text' },
      { key: 'pastHistory', label: 'Past History', type: 'textarea' },
      { key: 'foodAllergy', label: 'Food Allergy', type: 'text' },
      { key: 'dislikeFood', label: 'Dislike Food', type: 'text' },
      { key: 'supplement', label: 'Supplement', type: 'text' },
    ],
  },
];

export const STUDENT_FIELD_LABELS = STUDENT_FORM_STEPS.reduce((acc, step) => {
  step.fields.forEach((f) => { acc[f.key] = f.label; });
  return acc;
}, {});

export const BLANK_STUDENT = STUDENT_FORM_STEPS.reduce((acc, step) => {
  step.fields.forEach((f) => { acc[f.key] = ''; });
  return acc;
}, {});

export function isStepValid(step, values) {
  return step.fields.every((f) => !f.required || String(values[f.key] || '').trim());
}
