// Crude, dependency-free dish-name similarity — good enough to find "Paneer
// Bhurji" a photo from an existing "Paneer Bhurji Recipe" library entry, not
// meant to be exact. Shared by server/index.js (AI-suggested recipes have no
// photo of their own — Gemini generates text only, see geminiRecipeSuggest.js)
// and scripts/build-recipe-library.js (many near-duplicate recipes recur
// across the corpus with slightly different wording — "limited Salt" vs
// "Salt" — so they don't collapse via the exact-content hash dedup, and only
// SOME of the several occurrences had a photo embedded in their source doc).
// Filtered out of every token set — harmless for a short dish name (few
// contain any of these to begin with), but essential for matching a longer
// descriptive heading or guideline paragraph (Gear 3's "Water Law" freeText,
// for build-recipe-library.js's group-image backfill) against a short dish
// name: tokenOverlap's score is shared/max(sizeA, sizeB), so a 30-word
// paragraph's filler words ("as", "per", "your", "if", "any", "for", "the")
// would otherwise dilute a real match (e.g. "tea" from "detox tea") into a
// score too small to ever clear any reasonable threshold.
const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'as',
  'per', 'your', 'you', 'if', 'any', 'there', 'kindly', 'only', 'take', 'day', 'daily', 'please', 'not', 'it', 'its',
  's', 'this', 'that', 'be', 'by', 'at', 'from', 'into', 'up', 'out', 'no', 'do', 'does']);

// Tamil spells "tea" two ways across this corpus — தேநீர் (the native word,
// used bare in every tea RECIPE's own name) and டீ, the phonetic English
// loanword, which Water Law's own guideline text uses WITH a grammatical
// case suffix glued on — "...டிடாக்ஸ் டீயை..." ("...detox tea..." — யை
// marks the object of the sentence). Tamil has no spaces between a word and
// its suffix, so this whole glued form tokenizes as ONE word, டீயை, not the
// same token as bare தேநீர் — replaced whole (not just the டீ prefix, which
// would leave the யை suffix stuck onto தேநீர் and still not match) so Water
// Law's Tamil freeText can match a Tamil tea recipe's name via that shared
// word the same way the English pair ("detox tea" / "Tulsi Tea") already
// does.
function normalizeSynonyms(text) {
  return text.replace(/டீயை/g, 'தேநீர்');
}

function nameTokens(name) {
  const all = normalizeSynonyms((name || '').toLowerCase()).match(/[a-z஀-௿]+/g) || [];
  return new Set(all.filter((t) => !STOPWORDS.has(t)));
}

function tokenOverlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.max(a.size, b.size);
}

// `candidates` is any array of {name, image} — the caller decides what
// counts as a candidate (the whole recipe library, or a pre-filtered slice).
// Only candidates that already have an `image` are considered; returns the
// best-scoring one's image, or undefined if nothing clears `threshold`.
function findBestImageMatch(name, candidates, threshold) {
  const target = nameTokens(name);
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    if (!c.image) continue;
    const score = tokenOverlap(target, nameTokens(c.name));
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= threshold ? best.image : undefined;
}

// shared / min(sizeA, sizeB) — "how much of the SHORTER side is covered",
// rather than tokenOverlap's shared / max(...) ("how much of the LONGER
// side is covered"). Meant specifically for a long descriptive query (a
// guideline paragraph, 10+ meaningful words) against a short dish name (2-4
// words): under tokenOverlap, the paragraph's own length dominates the
// denominator, so even a real match (both mention "tea") scores too low to
// clear any reasonable threshold. Wrong choice for two similarly-short
// queries (name-vs-name matching, findBestImageMatch's normal use) — there
// it would let a 1-word query match almost anything with that word buried in
// a much longer candidate name, which is why this is a SEPARATE function.
function containmentOverlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}

function findBestImageMatchByContainment(text, candidates, threshold) {
  const target = nameTokens(text);
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    if (!c.image) continue;
    const score = containmentOverlap(target, nameTokens(c.name));
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= threshold ? best.image : undefined;
}

module.exports = { nameTokens, tokenOverlap, findBestImageMatch, containmentOverlap, findBestImageMatchByContainment };
