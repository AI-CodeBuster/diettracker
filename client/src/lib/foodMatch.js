// Finds a patient's disliked/allergic food terms inside the live-rendered
// docx-preview DOM and highlights them, and applies/reverts replacements.
//
// docx-preview renders real DOM text, but Word itself splits a paragraph's
// text across many <w:r> runs (bold/italic mid-word, spell-check artifacts,
// tracked-change remnants...), so a single food term can end up spread
// across several sibling text nodes/spans. We build one flat lowercase
// string of all the text under the render container plus an offset map back
// to the real nodes, search that flat string, then split/wrap the real text
// nodes covered by each match — rather than trying to pattern-match the DOM
// tree directly.

import { translateTerm } from './suggestSubstitute';

const NOISE_TERMS = new Set(['nil', 'none', 'na', 'n/a', '-', '–', '—', '']);

/** Splits a patient's free-text dislike/allergy field into individual terms. */
function extractTerms(freeText) {
  if (!freeText) return [];
  return freeText
    .split(/[,/&\n]|(?:\band\b)/i)
    .map((s) => s.trim())
    .filter((s) => s && !NOISE_TERMS.has(s.toLowerCase()));
}

function isInsideFlagOrReplacement(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el) {
    if (el.classList && (el.classList.contains('food-flag') || el.classList.contains('food-replaced'))) return true;
    el = el.parentElement;
  }
  return false;
}

/** Nearest paragraph/list-item/table-cell ancestor — docx-preview renders
 * each one as a separate element with no literal whitespace between them
 * (e.g. a bulleted ingredient list is one <p> per ingredient), so two
 * adjacent items can butt up directly against each other in the DOM text
 * ("...20 கிராம்" immediately followed by "வெங்காயம்" with zero
 * separator). Used by buildTextIndex to insert a boundary there. */
function nearestBlock(node) {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return el ? el.closest('p, li, td, th') : null;
}

/** Walks all text nodes under rootEl into one flat lowercase string + offset
 * map, inserting a space wherever the text crosses into a different
 * paragraph/list-item/table-cell — see nearestBlock — so a word-boundary
 * match doesn't wrongly fuse two separate rendered items into one run-on
 * token (which would otherwise make legitimate matches invisible) or, in
 * the other direction, wrongly treat the boundary-less run-on text as one
 * long unbroken word.
 */
function buildTextIndex(rootEl) {
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
      if (isInsideFlagOrReplacement(node)) return NodeFilter.FILTER_REJECT;
      const tag = node.parentElement && node.parentElement.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = '';
  const map = []; // [{ node, start, end }]
  let node;
  let lastBlock;
  let sawFirst = false;
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) {
    const block = nearestBlock(node);
    if (sawFirst && block !== lastBlock) text += ' ';
    sawFirst = true;
    lastBlock = block;
    const start = text.length;
    text += node.nodeValue;
    map.push({ node, start, end: text.length });
  }
  return { text: text.toLowerCase(), map };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds every occurrence of each term in the flat text, tagged with `source`
 * ('allergy' | 'dislike'). Overlapping matches are merged, with allergy
 * taking priority over dislike for the same span (more severe).
 */
function findMatches(index, terms, source) {
  const matches = [];
  for (const term of terms) {
    if (term.length < 3) continue; // too short to safely substring-match (e.g. stray "a")
    // \p{L}\p{N} (Unicode letter/number) rather than [a-z0-9]: the latter
    // only guards Latin-script boundaries, so it fails to stop a Tamil word
    // from matching as a false-positive substring inside a longer, unrelated
    // Tamil word (e.g. "முட்டை" (egg) is a literal prefix of "முட்டைகோஸ்"
    // (cabbage) — a Latin-only boundary would flag cabbage as an egg match).
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term.toLowerCase())}(?![\\p{L}\\p{N}])`, 'gu');
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = pattern.exec(index.text))) {
      matches.push({ start: m.index, end: m.index + m[0].length, term, source });
    }
  }
  return matches;
}

/** Merges overlapping matches from multiple term/source passes, allergy wins. */
function mergeMatches(matchLists) {
  const all = matchLists.flat().sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const m of all) {
    const last = merged[merged.length - 1];
    if (last && m.start < last.end) {
      if (m.source === 'allergy' && last.source !== 'allergy') {
        merged[merged.length - 1] = m; // upgrade severity, keep the wider/earlier span otherwise
      }
      continue;
    }
    merged.push(m);
  }
  return merged;
}

let matchCounter = 0;

function makeMark(source, match) {
  const mark = document.createElement('mark');
  mark.className = `food-flag food-flag-${source}`;
  mark.dataset.matchId = match.id;
  mark.dataset.term = match.term;
  mark.title = source === 'allergy' ? `Allergy: ${match.term}` : source === 'dislike' ? `Dislike: ${match.term}` : match.term;
  return mark;
}

/**
 * Wraps every match in `matches` (pristine offsets into `index`, which must
 * not have been mutated since it was built) in one or more <mark> elements.
 * A single match may need >1 mark if it spans multiple original text nodes
 * (Word run-splitting); several *different* matches may also land in the
 * same original node. Both cases are handled by grouping all sub-ranges by
 * the original node they fall in, then splitting each node's ranges from
 * rightmost to leftmost — so every split point is computed and applied
 * before any earlier (lower-offset) split in the same node could be
 * invalidated by node mutation, without needing to rebuild the index.
 */
function wrapMatches(index, matches) {
  const byNode = new Map(); // original node -> [{ localStart, localEnd, match }]
  for (const match of matches) {
    match.id = `fm-${++matchCounter}`;
    for (const entry of index.map) {
      if (entry.end <= match.start || entry.start >= match.end) continue;
      const localStart = Math.max(0, match.start - entry.start);
      const localEnd = Math.min(entry.end - entry.start, match.end - entry.start);
      if (localStart >= localEnd) continue;
      if (!byNode.has(entry.node)) byNode.set(entry.node, []);
      byNode.get(entry.node).push({ localStart, localEnd, match });
    }
  }

  for (const [node, ranges] of byNode) {
    ranges.sort((a, b) => b.localStart - a.localStart); // rightmost first
    for (const { localStart, localEnd, match } of ranges) {
      if (localEnd < node.nodeValue.length) node.splitText(localEnd);
      const target = localStart > 0 ? node.splitText(localStart) : node;
      const mark = makeMark(match.source, match);
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
    }
  }
}

/**
 * A patient's dislike/allergy terms are usually typed in English by coaches,
 * but a Tamil-language diet chart renders food names in Tamil script — a
 * plain English substring search would never match it. When `rules` (the
 * food-rules knowledge base) is given, each term's own Tamil translation is
 * looked up (via translateTerm) and added to the search list alongside the
 * original — scoped to that specific food only, e.g. "curd" adds only
 * "தயிர்", never the Tamil words for other DAIRY-category items like ghee
 * or milk that the patient wasn't actually reported as disliking/allergic
 * to.
 */
function withTamilTerms(terms, rules) {
  if (!rules) return terms;
  const extra = [];
  for (const term of terms) {
    extra.push(...translateTerm(rules, term));
  }
  return [...terms, ...extra];
}

/**
 * Scans rootEl for the given dislike/allergy free text, highlights matches,
 * and returns a summary list (one entry per logical match, in document
 * order) for the review UI.
 *
 * `rules` + `language: 'TAM'` additionally searches each term's Tamil
 * translation, so English-typed dislike/allergy terms are still found
 * inside a Tamil-language diet chart.
 */
function scanAndHighlight(rootEl, { allergyText, dislikeText, rules, language }) {
  const index = buildTextIndex(rootEl);
  const allergyTerms = extractTerms(allergyText);
  const dislikeTerms = extractTerms(dislikeText);
  const translate = language === 'TAM';
  const allergySearchTerms = translate ? withTamilTerms(allergyTerms, rules) : allergyTerms;
  const dislikeSearchTerms = translate ? withTamilTerms(dislikeTerms, rules) : dislikeTerms;

  const merged = mergeMatches([
    findMatches(index, allergySearchTerms, 'allergy'),
    findMatches(index, dislikeSearchTerms, 'dislike'),
  ]);

  wrapMatches(index, merged);
  const found = merged.map((m) => ({ id: m.id, term: m.term, source: m.source, text: index.text.slice(m.start, m.end) }));
  const foundTermsLower = new Set(found.map((f) => f.term.toLowerCase()));

  const unmatched = [...allergyTerms.map((t) => ({ term: t, source: 'allergy' })), ...dislikeTerms.map((t) => ({ term: t, source: 'dislike' }))]
    .filter((t) => {
      if (foundTermsLower.has(t.term.toLowerCase())) return false;
      if (!translate) return true;
      return !withTamilTerms([t.term], rules).some((tt) => foundTermsLower.has(tt.toLowerCase()));
    });

  return { found, unmatched };
}

/** Applies a text replacement to an already-highlighted match (by id). */
function applyReplacement(rootEl, matchId, newText) {
  const marks = rootEl.querySelectorAll(`mark[data-match-id="${matchId}"]`);
  if (!marks.length) return false;
  marks.forEach((mark, i) => {
    mark.className = 'food-replaced';
    mark.textContent = i === 0 ? newText : '';
  });
  return true;
}

/** Re-applies a previously-saved replacement by finding the original text fresh. */
function reapplySavedReplacement(rootEl, originalText, replacementText) {
  const index = buildTextIndex(rootEl);
  const idx = index.text.indexOf(originalText.toLowerCase());
  if (idx === -1) return false;
  const match = { start: idx, end: idx + originalText.length, term: originalText, source: 'replaced' };
  wrapMatches(index, [match]);
  applyReplacement(rootEl, match.id, replacementText);
  return true;
}

/** Undoes a replacement, restoring the food item exactly as it originally
 * appeared in the diet plan. applyReplacement collapsed a multi-mark match
 * down to one mark holding the replacement text (emptying the rest, but
 * leaving them in the DOM) — this puts the ORIGINAL text back on that same
 * first mark and restores the food-flag styling, mirroring applyReplacement
 * exactly in reverse rather than re-deriving anything from the current
 * (replaced) DOM state. */
function revertReplacement(rootEl, matchId, originalText, source) {
  const marks = rootEl.querySelectorAll(`mark[data-match-id="${matchId}"]`);
  if (!marks.length) return false;
  marks.forEach((mark, i) => {
    mark.className = `food-flag food-flag-${source}`;
    mark.textContent = i === 0 ? originalText : '';
    const term = mark.dataset.term;
    mark.title = source === 'allergy' ? `Allergy: ${term}` : source === 'dislike' ? `Dislike: ${term}` : term;
  });
  return true;
}

export {
  extractTerms, scanAndHighlight, applyReplacement, reapplySavedReplacement, revertReplacement,
  // findMatches/mergeMatches are pure string logic (unlike the rest of this
  // file, which mutates a live DOM tree) — exported so components/
  // FoodHighlight.jsx can reuse the exact same matching rules against a
  // plain string (a Diet Schedule table cell) instead of parsed docx-preview
  // HTML. See that file for why the DOM-wrapping half of this module
  // (wrapMatches/scanAndHighlight) can't be reused there directly.
  findMatches, mergeMatches,
};
