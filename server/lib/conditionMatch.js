// Mirrors client/src/lib/matchDiet.js's detectConditions/detectComorbid
// exactly — the recipe eligibility engine (recipeEligibility.js) needs to
// read a patient's full set of detected conditions server-side, against the
// whole recipe library, so it can't just call the client module. Keep both
// in sync if this logic ever changes, same convention as lib/bmi.js.
const BASE_CONDITIONS = ['KIDNEY', 'THYROID', 'DIABETES', 'BP', 'CHOLESTEROL'];
const PRIORITY = ['KIDNEY', 'THYROID', 'DIABETES', 'BP', 'CHOLESTEROL'];

const CONDITION_PATTERNS = {
  KIDNEY: /kidney|renal|\bckd\b/i,
  THYROID: /thyroid/i,
  DIABETES: /diabet/i,
  BP: /\bbp\b|hypertension/i,
  CHOLESTEROL: /cholestrol|cholesterol|\blipid/i,
};

const GASTRIC_PATTERN = /gastric|ulcer|acidity|acidy\b|acid reflux|gerd|bloating|heartburn/i;

function stripNegatedDiabetes(text) {
  return text.replace(/non[\s-]*diabet(ic|es)?/gi, ' ');
}

function detectConditions(text) {
  if (!text) return [];
  const cleaned = stripNegatedDiabetes(text);
  return PRIORITY.filter((c) => CONDITION_PATTERNS[c].test(cleaned));
}

function detectComorbid(text) {
  if (!text) return null;
  return GASTRIC_PATTERN.test(text) ? 'GASTRIC' : null;
}

module.exports = { BASE_CONDITIONS, detectConditions, detectComorbid };
