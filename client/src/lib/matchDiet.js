// Figures out which diet-plan .docx (from server/manifest.json) best matches
// a given person for a given gear (2/3/4), based on whatever condition info
// the spreadsheet has for them.
//
// The underlying data is real operational data typed by many different
// coaches, so condition text is inconsistent free text ("DIABETES,BP,KIDNEY",
// "diabtes ,cholesterol", "NON-DIABETES +gastric issues", ...). We detect all
// plausible base conditions instead of guessing a single one, rank them by a
// clinical-priority order, and let the caller (the viewer modal) offer the
// alternates + manual overrides rather than silently picking one.

const BASE_CONDITIONS = ['KIDNEY', 'THYROID', 'DIABETES', 'BP', 'CHOLESTEROL'];
// Kidney/thyroid diets are the most restrictive & specific, so when a
// person's text mentions multiple conditions we default to the most
// clinically-specific one first.
const PRIORITY = ['KIDNEY', 'THYROID', 'DIABETES', 'BP', 'CHOLESTEROL'];

const CONDITION_PATTERNS = {
  KIDNEY: /kidney|renal|\bckd\b/i,
  THYROID: /thyroid/i,
  DIABETES: /diabet/i,
  BP: /\bbp\b|hypertension/i,
  // Coaches' own notes carry the same "cholestrol" misspelling as the source
  // documents — matched here too, not just in build-manifest.js.
  CHOLESTEROL: /cholestrol|cholesterol|\blipid/i,
};

// Deliberately does NOT include a bare "acid" match: "uric acid" (and its
// many typo'd spellings like "uiric acid"), "folic acid", "amino acid" etc.
// are common unrelated medical terms in this data, and a bare "acid" match
// would misread all of them as gastric/ulcer/acidity.
const GASTRIC_PATTERN = /gastric|ulcer|acidity|acidy\b|acid reflux|gerd|bloating|heartburn/i;

// "Non-Diabetic"/"NON DIABETES" are explicit negations, but the substring
// "diabet" inside them would otherwise match the DIABETES pattern and flip
// an explicit "does NOT have diabetes" note into a false positive.
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

/** Text used to infer condition for a specific gear: prefer that gear's own
 * free-text "Diet type" field (set by the coach when preparing that gear's
 * diet), fall back to the person's general clinical text. */
function conditionTextForGear(person, gear) {
  const gearText = person.gearDietType && person.gearDietType[gear];
  if (gearText && gearText.trim()) return gearText;
  return person.conditionRaw || '';
}

/** Score a manifest entry against a person's stated preferences. */
function scoreEntry(entry, { dietType, language }) {
  let score = 0;
  if (dietType && entry.dietType === dietType) score += 10;
  if (language && entry.language === language) score += 1;
  return score;
}

/**
 * Query the manifest for entries matching a condition/comorbid/gear, ranked
 * by how well they match the person's diet-type & language preference.
 */
function queryManifest(manifestFiles, { condition, comorbid, gear, dietType, language }) {
  const candidates = manifestFiles.filter(
    (f) => f.condition === condition && f.gear === gear && (f.comorbid || null) === (comorbid || null)
  );
  return candidates
    .map((entry) => ({ entry, score: scoreEntry(entry, { dietType, language }) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.entry);
}

/**
 * Main entry point: returns a ranked list of match "options" for a person +
 * gear. Each option has { condition, comorbid, best, alternatives, exactDietType, exactLanguage }.
 * The first option in the list is the suggested default.
 */
function matchDietOptions(manifestFiles, person, gear) {
  const text = conditionTextForGear(person, gear);
  let conditions = detectConditions(text);
  if (!conditions.length) conditions = ['DIABETES']; // program default
  const comorbid = detectComorbid(text);

  const options = conditions.map((condition) => {
    // Try with comorbid first (if detected), fall back to plain condition
    // if that combo has no files at all.
    let ranked = queryManifest(manifestFiles, {
      condition,
      comorbid,
      gear,
      dietType: person.vegPreference,
      language: person.language,
    });
    let usedComorbid = comorbid;
    if (!ranked.length && comorbid) {
      ranked = queryManifest(manifestFiles, {
        condition,
        comorbid: null,
        gear,
        dietType: person.vegPreference,
        language: person.language,
      });
      usedComorbid = null;
    }
    if (!ranked.length) return null;
    const best = ranked[0];
    return {
      condition,
      comorbid: usedComorbid,
      best,
      alternatives: ranked.slice(1),
      exactDietType: best.dietType === person.vegPreference,
      exactLanguage: best.language === person.language,
    };
  }).filter(Boolean);

  return options;
}

/** All the free text we have about a person, gear-specific notes included,
 * pooled together for a single overall "what condition(s) do they have"
 * read (used for the at-a-glance badge on the person card). */
function personConditionText(person) {
  const parts = [person.conditionRaw];
  if (person.gearDietType) {
    for (const g of [4, 3, 2]) {
      if (person.gearDietType[g]) parts.push(person.gearDietType[g]);
    }
  }
  return parts.filter(Boolean).join(' | ');
}

/**
 * Auto-detects a person's condition(s) from their spreadsheet data, for
 * display (e.g. a badge on the person card) independent of any specific
 * gear. Returns { conditions, comorbid, isDefaulted } — isDefaulted is true
 * when nothing in their notes mentioned a known condition and we fell back
 * to the program default (Diabetes).
 */
function detectPersonCondition(person) {
  const text = personConditionText(person);
  let conditions = detectConditions(text);
  const isDefaulted = !conditions.length;
  if (isDefaulted) conditions = ['DIABETES'];
  const comorbid = detectComorbid(text);
  return { conditions, comorbid, isDefaulted };
}

export {
  matchDietOptions,
  queryManifest,
  detectConditions,
  detectComorbid,
  detectPersonCondition,
  BASE_CONDITIONS,
};
