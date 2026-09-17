// Calls Gemini to generate a full alternative RECIPE (name + ingredients +
// preparation) for the [Replace Recipe] picker's "AI Suggestion" tab —
// distinct from lib/geminiSuggest.js, which only suggests a short list of
// dish NAMES for a single flagged ingredient. This asks for one complete,
// ready-to-use recipe, in the same shape the rest of the app already
// renders (client/src/components/DietTemplateView.jsx's Recipe card).
const { callGemini } = require('./geminiClient');
// Raised from 20s while diagnosing a live "Gemini AI not working" report —
// a direct check found a real (non-retried) call taking 13.6s to succeed
// under that same load, uncomfortably close to the old timeout; retries
// (see geminiClient.js) each get their own fresh budget, so an overloaded
// FIRST attempt failing fast still doesn't cost this much time overall.
const TIMEOUT_MS = 30_000;

const DIET_LABELS = { VEG: 'Vegetarian', NONVEG: 'Non-Vegetarian', EGG: 'Eggetarian' };
const LANGUAGE_LABELS = { TAM: 'Tamil', ENG: 'English' };
const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: 'Short dish name, 2-6 words' },
    ingredients: { type: 'ARRAY', items: { type: 'STRING' }, description: 'One ingredient with quantity per line' },
    steps: { type: 'ARRAY', items: { type: 'STRING' }, description: 'One preparation step per line, imperative mood' },
  },
  required: ['name', 'ingredients', 'steps'],
};

function buildPrompt({ recipe, dietType, language, conditions, mealType, allergyText, dislikeText }) {
  const dietLabel = DIET_LABELS[dietType] || 'Vegetarian';
  const languageLabel = LANGUAGE_LABELS[language] || 'English';
  const mealLabel = MEAL_LABELS[mealType] || 'meal';
  const conditionText = conditions && conditions.length ? conditions.join(', ') : 'no specific condition on file';

  return `You are a dietitian's assistant generating one alternative recipe for a patient's Indian / South Indian diet chart.

CURRENT RECIPE BEING REPLACED:
Name: ${recipe.name}
Ingredients: ${(recipe.ingredients || []).join('; ') || '(none listed)'}
Preparation: ${(recipe.steps || []).join(' ') || '(none listed)'}

PATIENT CONTEXT:
- Medical condition(s): ${conditionText}
- Diet type: ${dietLabel}
- Meal: ${mealLabel}
- Output language: ${languageLabel}
${allergyText ? `- Allergic to (MUST NOT appear in the alternative, in any form): ${allergyText}\n` : ''}${dislikeText ? `- Dislikes (avoid where a reasonable substitute exists): ${dislikeText}\n` : ''}
Generate ONE alternative recipe suitable for this patient in place of the current one. Requirements:
- Nutritionally comparable to the current recipe — similar calorie range, similar macro role (if the current recipe is protein-forward, keep the alternative protein-forward; if it's a light salad, keep the alternative similarly light), and appropriate for the stated medical condition(s) (e.g. low-glycemic-load choices for diabetes, potassium-conscious choices for kidney conditions, low-sodium for blood pressure).
- Strictly ${dietLabel} — no ingredients outside that diet type.
- Absolutely must not contain any allergen listed above, under any name or form.
- A genuinely different dish from the current recipe, not a trivial rewording of it.
- Ingredients as a list, each with an approximate quantity, in the terse style of a real diet chart.
- Preparation as a short numbered sequence of imperative steps (e.g. "Chop the vegetables", "Boil for 5 minutes").
- Everything written in ${languageLabel}.
- Respond only via the JSON schema — no extra commentary.`;
}

/**
 * @param {object} params
 * @param {{name:string, ingredients?:string[], steps?:string[]}} params.recipe - the recipe being replaced
 * @param {string} [params.dietType] - 'VEG'|'NONVEG'|'EGG'
 * @param {string} [params.language] - 'ENG'|'TAM'
 * @param {string[]} [params.conditions] - detected condition codes, e.g. ['DIABETES']
 * @param {string} [params.mealType] - 'breakfast'|'lunch'|'dinner'
 * @param {string} [params.allergyText] - patient's free-text allergies
 * @param {string} [params.dislikeText] - patient's free-text dislikes
 * @returns {Promise<{name:string, ingredients:string[], steps:string[]}>}
 */
async function suggestRecipeViaAI(params) {
  const parsed = await callGemini(buildPrompt(params), RESPONSE_SCHEMA, { timeoutMs: TIMEOUT_MS });
  const name = String(parsed.name || '').trim();
  const ingredients = (parsed.ingredients || []).map((s) => String(s).trim()).filter(Boolean);
  const steps = (parsed.steps || []).map((s) => String(s).trim()).filter(Boolean);
  if (!name || !ingredients.length || !steps.length) throw new Error('Gemini returned an incomplete recipe');
  return { name, ingredients, steps };
}

module.exports = { suggestRecipeViaAI };
