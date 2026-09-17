// Finds recipes from the whole cross-condition library (server/diet-data/
// recipe-library.json, built by scripts/build-recipe-library.js) that are
// safe and appropriate to offer as a replacement for a specific patient and
// meal — the engine behind the [Replace Recipe] picker.
//
// A human dietitian always makes the final choice from what this returns
// (see the app's "Allow dietitian to select replacement" requirement), so
// this errs toward a reasonably permissive shortlist rather than a
// perfectly precise one: hard filters only for genuine safety (diet type,
// allergens); everything else is ranking, not exclusion.
const { detectConditions } = require('./conditionMatch');
const { findRuleForTerm } = require('./foodRules');

const NOISE_TERMS = new Set(['nil', 'none', 'na', 'n/a', '-', '–', '—', '']);

// Mirrors client/src/lib/foodMatch.js's extractTerms exactly — splits a
// patient's free-text allergy/dislike field into individual terms.
function extractTerms(freeText) {
  if (!freeText) return [];
  return freeText
    .split(/[,/&\n]|(?:\band\b)/i)
    .map((s) => s.trim())
    .filter((s) => s && !NOISE_TERMS.has(s.toLowerCase()));
}

// Maps a set of patient-typed terms to the food-rule CATEGORIES they belong
// to (e.g. "peanut" -> PEANUT_NUTS), since that's what a recipe is tagged
// with (build-recipe-library.js scans each recipe's own ingredients the
// same way) — comparing categories, not raw words, is what lets "cashew"
// correctly exclude a recipe whose ingredient list says "kaju".
function categoriesForTerms(terms) {
  const cats = new Set();
  for (const term of terms) {
    const rule = findRuleForTerm(term);
    if (rule) cats.add(rule.category);
  }
  return cats;
}

// A recipe tagged "DIABETES+GASTRIC" is still relevant to a plain-DIABETES
// patient (and vice versa) — comorbid-specific recipes aren't so different
// from the base condition's that they should be hidden entirely, just
// something the dietitian can see is comorbid-tagged and judge for
// themselves. Matching on the base condition, not the exact compound
// string, is what makes that work.
function baseCondition(tag) {
  return tag.split('+')[0];
}

function conditionMatches(recipeConditions, patientConditions) {
  if (!patientConditions.length) return true; // nothing detected — don't over-filter
  return recipeConditions.some((rc) => patientConditions.includes(baseCondition(rc)));
}

/**
 * @param {object[]} library - the full recipe-library.json array
 * @param {object} params
 * @param {string} [params.mealType] - 'breakfast'|'lunch'|'dinner'
 * @param {string} [params.dietType] - 'VEG'|'NONVEG'|'EGG'
 * @param {string} [params.conditionText] - the patient's free-text condition notes (conditionRaw)
 * @param {string} [params.language] - 'ENG'|'TAM'
 * @param {string} [params.allergyText] - the patient's free-text food allergies
 * @param {string} [params.dislikeText] - the patient's free-text food dislikes
 * @param {string} [params.excludeRecipeId] - never return the recipe currently in that slot
 * @param {string} [params.search] - free-text match against the recipe's own name, for browsing the
 *   whole library (the [Add Recipe] picker) rather than filling one specific slot
 * @param {number} [params.limit]
 * @returns {{ items: object[], excludedForAllergy: number }}
 */
function findEligibleRecipes(library, params) {
  const {
    mealType, dietType, conditionText, language, allergyText, dislikeText,
    excludeRecipeId, search, limit = 20,
  } = params;

  const conditions = detectConditions(conditionText);
  const allergyCats = categoriesForTerms(extractTerms(allergyText));
  const dislikeCats = categoriesForTerms(extractTerms(dislikeText));
  const searchTerm = search ? search.trim().toLowerCase() : '';

  // Hard filters — never shown regardless of ranking.
  let candidates = library.filter((r) =>
    r.recipe_id !== excludeRecipeId
    && (!mealType || r.mealTypes.includes(mealType))
    && (!dietType || r.dietTypes.includes(dietType))
    && (!language || r.language === language)
    && conditionMatches(r.conditions, conditions)
    && (!searchTerm || r.name.toLowerCase().includes(searchTerm)),
  );

  const beforeAllergyFilter = candidates.length;
  candidates = candidates.filter((r) => !r.allergens.some((cat) => allergyCats.has(cat)));
  const excludedForAllergy = beforeAllergyFilter - candidates.length;

  // Soft ranking, not exclusion: reviewed recipes first, then fewer
  // dislike-category matches first — never drops a recipe just because the
  // patient dislikes one ingredient in it, since the dietitian is the one
  // deciding whether that actually rules it out.
  const scored = candidates.map((r) => {
    const dislikeHits = r.allergens.filter((cat) => dislikeCats.has(cat)).length;
    const score = (r.reviewed ? 0 : 1000) + dislikeHits * 10;
    return { r, score };
  });
  scored.sort((a, b) => a.score - b.score);

  return {
    items: scored.slice(0, limit).map(({ r }) => r),
    total: candidates.length,
    excludedForAllergy,
  };
}

module.exports = { findEligibleRecipes, extractTerms, categoriesForTerms };
