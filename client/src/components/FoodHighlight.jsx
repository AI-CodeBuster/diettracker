// Allergy/dislike highlighting for the NEW data-driven diet viewer
// (DietTemplateView.jsx's recipe cards and Diet Schedule tables) — a
// plain-string sibling of client/src/lib/foodMatch.js's scanAndHighlight,
// which only knows how to splice <mark> elements into an already-rendered,
// React-free DOM tree (the old .docx-preview viewer's own output). This
// viewer's tables/cards are owned and re-rendered by React on every data
// change, so highlighting has to produce JSX React itself renders, not
// out-of-band DOM mutation — same underlying match-finding rules
// (findMatches/mergeMatches, reused verbatim from foodMatch.js), just a
// different, much simpler final step.
import { findMatches, mergeMatches } from '../lib/foodMatch';
import { translateTerm } from '../lib/suggestSubstitute';

// A patient's dislike/allergy terms are typically typed in English by
// coaches, but a Tamil-language diet chart renders food names in Tamil
// script — a plain English substring search would never match it. Each
// term's own Tamil translation (via translateTerm, scoped to that specific
// food only — never the rest of its substitute category) is added to the
// search list alongside the original, same convention as foodMatch.js's own
// withTamilTerms for the old viewer.
function withTamilTerms(terms, rules) {
  if (!rules || !rules.length || !terms.length) return terms;
  const extra = [];
  for (const term of terms) extra.push(...translateTerm(rules, term));
  return extra.length ? [...terms, ...extra] : terms;
}

// `findMatches` only ever reads `index.text` (never `index.map`, which is
// docx-preview's DOM-node offset table) — a bare { text } is a complete
// enough "index" for matching against one plain string. `rules`/`language`
// are optional — omitting them just skips Tamil translation (English-only
// matching, same as before this existed).
function findTermMatches(text, allergyTerms, dislikeTerms, rules, language) {
  if (!text) return [];
  const translate = language === 'TAM';
  const allergySearchTerms = translate ? withTamilTerms(allergyTerms, rules) : allergyTerms;
  const dislikeSearchTerms = translate ? withTamilTerms(dislikeTerms, rules) : dislikeTerms;
  const index = { text: text.toLowerCase() };
  return mergeMatches([
    findMatches(index, allergySearchTerms, 'allergy'),
    findMatches(index, dislikeSearchTerms, 'dislike'),
  ]);
}

// Wraps each match in the exact same <mark class="food-flag food-flag-...">
// markup/CSS the old viewer already uses (App.css's .food-flag rules,
// yellow --flag-highlight-bg), so a coach sees one consistent highlight
// style across both viewers. Returns `text` itself (no wrapping) when
// nothing matches, so a caller can always just render this in place of the
// plain string.
function highlightFoodTerms(text, allergyTerms, dislikeTerms, rules, language) {
  if (typeof text !== 'string' || !text) return text;
  const matches = findTermMatches(text, allergyTerms, dislikeTerms, rules, language);
  if (!matches.length) return text;
  const parts = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) parts.push(text.slice(cursor, m.start));
    parts.push(
      <mark
        key={i}
        className={`food-flag food-flag-${m.source}`}
        title={m.source === 'allergy' ? `Allergy: ${m.term}` : `Dislike: ${m.term}`}
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    cursor = m.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

// Just the count, for the top-of-plan warning banner — same matching rules,
// no JSX built (the banner only needs a number, not where each match is).
function countFoodTermMatches(text, allergyTerms, dislikeTerms, rules, language) {
  return findTermMatches(text, allergyTerms, dislikeTerms, rules, language).length;
}

export { highlightFoodTerms, countFoodTermMatches };
