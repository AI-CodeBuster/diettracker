// Shared between PatientProfile.jsx (raw per-gear display, existing) and
// PatientCoverPage.jsx (the new categorized panel) — one place for the
// field labels and the moderate/high categorization the management document
// asks for ("Moderate/Borderline Values: Yellow table. High/Abnormal
// Values: Red table.").
//
// THRESHOLDS ARE A CLINICAL JUDGMENT CALL, NOT A CODING ONE. The values
// below are standard ADA reference ranges (HbA1c %, fasting/post-prandial
// glucose mg/dL) used as a defensible starting point — confirm or correct
// them with the dietitian team before trusting this panel for real patients.
const FINDING_LABELS = { fasting: 'Fasting', postPrandial: 'Post Prandial', hba1c: 'HbA1c', otherFindings: 'Other Findings' };

const THRESHOLDS = {
  hba1c: { moderate: 5.7, high: 6.5 }, // %
  fasting: { moderate: 100, high: 126 }, // mg/dL
  postPrandial: { moderate: 140, high: 200 }, // mg/dL
};

function parseNumeric(raw) {
  const text = (raw || '').toString().trim();
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

// 'high' | 'moderate' | 'normal' | null — null means no category applies:
// either this `kind` has no defined threshold (otherFindings is free text,
// can't be thresholded) or no numeric value could be read from the raw
// string at all.
function categorizeBloodFinding(kind, rawValue) {
  const t = THRESHOLDS[kind];
  if (!t) return null;
  const n = parseNumeric(rawValue);
  if (n == null) return null;
  if (n >= t.high) return 'high';
  if (n >= t.moderate) return 'moderate';
  return 'normal';
}

export { FINDING_LABELS, categorizeBloodFinding };
