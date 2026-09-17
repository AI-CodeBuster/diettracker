// Looks up a suggested replacement for a flagged term. findRuleForTerm and
// translateTerm below are the *detection*-side helpers (used by
// foodMatch.js to find/highlight flagged words) and stay purely local —
// only suggestSubstitutes (the "Auto" button's suggestion list) calls out
// to the server, which asks Gemini for fresh alternatives on every call.
import { apiFetch } from './apiFetch';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary-aware "is `needle` a bounded word/phrase inside `haystack`"
// check. Plain .includes() would let "nuts" match inside "peanuts", or
// "egg" match inside "eggplant" (and, on the Tamil side, "முட்டை" (egg)
// match inside "முட்டைகோஸ்" (cabbage)) — unrelated foods that merely share
// letters. \p{L}\p{N} (Unicode letter/number) covers Tamil script too,
// unlike a Latin-only [a-z0-9] boundary.
function containsWord(haystack, needle) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'u').test(haystack);
}

function matchesSubTerm(term, sub) {
  const allKeywords = [...(sub.keywords || []), ...(sub.tamilKeywords || [])];
  return allKeywords.some((kw) => {
    const k = kw.toLowerCase();
    return containsWord(term, k) || containsWord(k, term);
  });
}

/** Whole-category match (for substitute suggestions) — e.g. a "curd"
 * allergy is recognized as belonging to the whole DAIRY category here, so
 * it can offer any dairy-appropriate substitute. */
function findRuleForTerm(rules, term) {
  const t = (term || '').toLowerCase().trim();
  if (!t) return null;
  return rules.find((rule) => {
    // Rules from /api/food-rules carry both the narrower `terms` sub-groups
    // and a flattened `keywords`/`tamilKeywords` view for this whole-rule
    // check; fall back to the flattened view if `terms` isn't present.
    const subs = rule.terms || [{ keywords: rule.keywords, tamilKeywords: rule.tamilKeywords }];
    return subs.some((sub) => matchesSubTerm(t, sub));
  }) || null;
}

/**
 * Finds the Tamil translation(s) for one *specific* dislike/allergy term —
 * e.g. "curd" -> ["தயிர்"] — scoped to just that food, not the whole
 * substitute category it belongs to (a "curd" allergy must never also
 * translate to "நெய்"/"பால்" just because ghee/milk share the DAIRY
 * category — that would flag foods the patient was never reported allergic
 * to). Used by foodMatch.js to search a Tamil-language diet chart for an
 * English-typed dislike/allergy term.
 */
function translateTerm(rules, term) {
  const t = (term || '').toLowerCase().trim();
  if (!t) return [];
  for (const rule of rules) {
    const subs = rule.terms || [{ keywords: rule.keywords, tamilKeywords: rule.tamilKeywords }];
    const sub = subs.find((s) => matchesSubTerm(t, s));
    if (sub) return sub.tamilKeywords || [];
  }
  return [];
}

const FALLBACK_TEXT = {
  ENG: 'Ask dietitian for a suitable alternative',
  TAM: 'உகந்த மாற்று உணவுக்கு டயட்டீஷியனிடம் கேளுங்கள்',
};

/**
 * Asks the server (which asks Gemini) for fresh alternatives to a flagged
 * term, tailored to the patient's diet type and the chart's language — every
 * "Auto" click generates a new AI suggestion rather than picking from a
 * fixed local list. If the request fails outright (network error, server
 * down), falls back to the generic placeholder client-side; the server
 * itself separately falls back to the curated foodRules.js list if only the
 * Gemini call fails, so this local fallback is a last resort, not the norm.
 * @param {string} term - the matched flagged term
 * @param {'VEG'|'NONVEG'|'EGG'|null} dietType - patient's diet type preference
 * @param {'TAM'|'ENG'|null} language - language of the diet plan being viewed
 * @returns {Promise<{ items: string[], source: 'ai'|'fallback' }>}
 */
async function suggestSubstitutes(term, dietType, language) {
  const fallback = FALLBACK_TEXT[language] || FALLBACK_TEXT.ENG;
  try {
    const res = await apiFetch('/api/suggest-alternative', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term, dietType, language }),
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data.items) && data.items.length ? data.items : [fallback];
    return { items, source: data.source || 'fallback' };
  } catch {
    return { items: [fallback], source: 'fallback' };
  }
}

export { suggestSubstitutes, findRuleForTerm, translateTerm };
