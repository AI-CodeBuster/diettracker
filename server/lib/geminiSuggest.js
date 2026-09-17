// Calls the Gemini API to generate alternative food suggestions for a
// flagged allergy/dislike term. Used for every "Auto" click (not just as a
// fallback for unrecognized foods) — server/index.js falls back to the
// curated foodRules.js list only if this call itself fails, so a Gemini
// outage or missing/invalid API key never leaves the coach with nothing.
const { callGemini } = require('./geminiClient');
const TIMEOUT_MS = 15_000;

const DIET_LABELS = { VEG: 'Vegetarian', NONVEG: 'Non-Vegetarian', EGG: 'Eggetarian' };
const LANGUAGE_LABELS = { TAM: 'Tamil', ENG: 'English' };

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'At least 5 short alternative dish names',
    },
  },
  required: ['items'],
};

function buildPrompt(term, dietType, language) {
  const dietLabel = DIET_LABELS[dietType] || 'Vegetarian';
  const languageLabel = LANGUAGE_LABELS[language] || 'English';
  return `You are helping a dietitian find alternative food suggestions for a patient's diet chart.

The patient is allergic to or dislikes: "${term}"
Diet type: ${dietLabel}
Output language: ${languageLabel}

Suggest at least 5 alternative food items that could replace "${term}" in an Indian / South Indian diet chart. Requirements:
- Each alternative should be nutritionally comparable to "${term}" — matching its role (e.g. if it's a protein source, suggest other protein sources; if it's a vegetable, suggest other vegetables with a similar calorie/fiber profile; if it's a spice, suggest other flavoring agents), not just "avoid it."
- Every suggestion must be appropriate for a ${dietLabel} diet.
- Write each suggestion as a short dish name (2-5 words), in the same terse style used on a real diet chart (e.g. "Paneer Bhurji", "Grilled Chicken (small portion)", "Ridge Gourd Poriyal").
- Write every suggestion in ${languageLabel}.
- Do not include any explanation or extra text — only the dish names, via the JSON schema.`;
}

/**
 * @param {{ term: string, dietType: 'VEG'|'NONVEG'|'EGG'|null, language: 'TAM'|'ENG'|null }} params
 * @returns {Promise<string[]>} at least one suggestion; throws if Gemini is unreachable, misconfigured, or returns something unusable.
 */
async function suggestAlternativesViaAI({ term, dietType, language }) {
  const parsed = await callGemini(buildPrompt(term, dietType, language), RESPONSE_SCHEMA, { timeoutMs: TIMEOUT_MS });
  const items = (parsed.items || []).map((s) => String(s).trim()).filter(Boolean);
  if (!items.length) throw new Error('Gemini returned no usable suggestions');
  return items;
}

module.exports = { suggestAlternativesViaAI };
