// Renders a diet-plan from structured data (see server/diet-data/schema.md)
// as an app screen — tabbed sections, cards, tag pills, the same visual
// language as the rest of the tracker — rather than a scrollable facsimile
// of the source .docx page. Every field is a plain string/array in normal
// HTML flow, so editing one (a longer dish name, one more ingredient, a
// rewritten step) just makes its own element taller; nothing is positioned
// against anything else, so there's nothing for that edit to overlap or
// misalign — the failure mode both the .docx table and the old raw-XML
// text-splice risked.
//
// A plan is a CHAIN of meals, not a single document: each gear's file holds
// one meal, so Gear 2 renders Breakfast + Lunch + Dinner, Gear 3 renders
// Lunch + Dinner, Gear 4 renders Dinner alone (see lib/gearChain.js). Meals
// are the outer tab row; each meal keeps its own inner tabs for its schedule
// and recipe groups, so one meal's sections never mix with another's.
//
// On screen only the active tab is visible; every tab is always rendered
// (a CSS display toggle, not conditional rendering) precisely so "Download
// as PDF" — the browser's own print dialog, saved as a PDF, same mechanism
// client/src/lib/printDoc.js already uses for the .docx viewer — sees and
// prints every meal and every section regardless of which one happened to
// be open, via a plain @media print override.
import { useEffect, useMemo, useRef, useState } from 'react';
import PatientCoverPage from './PatientCoverPage';
import { RemarkFlag, renderWithHighlight } from './RemarkFlag';
import { highlightFoodTerms, countFoodTermMatches } from './FoodHighlight';
import { extractTerms } from '../lib/foodMatch';
import AuthedImage from './AuthedImage';
import RecipeReplaceModal from './RecipeReplaceModal';
import AddRecipeModal from './AddRecipeModal';
import EditRecipeModal from './EditRecipeModal';
import { ADDED_RECIPES_HEADING } from '../lib/applyRecipeOverrides';
import { mealPlanTableKey, infoTableKey } from '../lib/applyScheduleOverrides';

// Lowercase, matching the recipe library's own mealType tags (server/scripts/
// build-recipe-library.js) — deliberately not reusing gearChain.js's
// GEAR_MEAL_LABELS, which is the capitalized display label ("Breakfast"),
// not the API's filter value.
const MEAL_TYPE_BY_GEAR = { 2: 'breakfast', 3: 'lunch', 4: 'dinner' };

// Gear 3's "Shop Organic Products" freeText line carries a real URL inline
// ("Buy Organic Food products in our own True Food Store: https://forms.gle/
// ..."), same as some Salad/Water Law paragraphs elsewhere in the corpus —
// turned into a real clickable link at render time rather than adding a
// separate structured {label, url} field to the schema just for this one
// case, since every other freeText paragraph is (and should stay) a plain
// string.
const URL_RE = /(https?:\/\/\S+)/g;

// Groups a flat recipe list into pairs so the PDF prints exactly 2 cards per
// page (see the .diet-recipe-page rule in App.css) — on screen this grouping
// is invisible (`display: contents`) and cards keep flowing through the
// existing responsive grid exactly as before pairing existed; only
// `@media print` reads it as a page unit. A trailing odd recipe out becomes
// its own solo "pair".
function chunkPairs(items) {
  const pairs = [];
  for (let i = 0; i < items.length; i += 2) pairs.push(items.slice(i, i + 2));
  return pairs;
}
function Linkify({ text }) {
  // String.split() with ONE capturing group interleaves the captures into
  // the result at odd indices — [before, match, between, match, after] —
  // so which part is a URL is known from its position, not re-tested
  // against the regex (a global regex's own .test() is stateful across
  // calls and would silently skip alternating matches if used here).
  const parts = text.split(URL_RE);
  return parts.map((part, i) => (i % 2 === 1
    ? <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a>
    : <span key={i}>{part}</span>));
}

// ---------- Diet Remarks (TL highlight + comment) ----------
// A TL flags one BLOCK of the rendered plan — a recipe card, a freeText
// line, a Diet Schedule table row, or a Diet Preference Questionnaire field
// on the cover page — as wrong, with a comment explaining why. The remark's
// own LOCATION is a stable, deterministic key (built from the gear and that
// block's own position/id, never from DOM state), which is what lets the
// exact same remark reappear correctly next time this plan is opened, long
// after the click that made it, in a totally different render — but the
// visible HIGHLIGHT itself always targets only the exact text the TL
// actually selected (see renderWithHighlight in RemarkFlag.jsx), falling
// back to highlighting that whole block only when a remark was raised via
// the 🖍 flag button directly (no selection to pinpoint) or its exact text
// no longer appears in the block's current content.
function recipeRemarkKey(gear, groupHeading, subHeading, recipe, idx) {
  return `recipe:${gear}:${subHeading || groupHeading}:${recipe.recipe_id || idx}`;
}
function freeTextRemarkKey(gear, groupHeading, lineIndex) {
  return `freetext:${gear}:${groupHeading}:${lineIndex}`;
}
// Diet Schedule's own three remarkable shapes — a meal-plan table's day row,
// a plain info table's row (Do's/Don'ts, Restrict/Reduce/Replace...), and a
// free-standing note line. Distinct prefixes/namespaces from recipe/freeText
// keys above (and from each other) even though the FORMAT looks similar, so
// a schedule row can never collide with an unrelated recipe-group block that
// happens to share a heading/index.
function scheduleRowRemarkKey(gear, planTitle, rowIndex) {
  return `schedulerow:${gear}:${planTitle}:${rowIndex}`;
}
function infoRowRemarkKey(gear, tableTitle, rowIndex) {
  return `inforow:${gear}:${tableTitle}:${rowIndex}`;
}
function noteRemarkKey(gear, lineIndex) {
  return `note:${gear}:${lineIndex}`;
}
// A single ingredient/step LINE inside a recipe card, not the whole card —
// raised by selecting text on that line rather than clicking a flag button
// (see Recipe's onMouseUp handler below). Derived from the CARD's own
// remarkKey (recipe:${gear}:${groupOrSub}:${idOrIdx}) rather than taking
// gear/groupHeading/subHeading/idx as its own separate params: Recipe
// already receives its card-level remarkKey as a prop, and swapping that
// key's own prefix for this one keeps the "same dish, same slot" identity
// consistent without threading 3 more props through every call site.
function recipeLineRemarkKey(cardRemarkKey, kind, lineIndex) {
  return `recipeline:${cardRemarkKey.replace(/^recipe:/, '')}:${kind}:${lineIndex}`;
}

// Select-text-to-highlight, generalized to EVERY remarkable block in the
// plan (recipe cards, an individual ingredient/step line, a freeText line, a
// schedule/info table row, a note) rather than just recipe lines — one
// delegated `mouseup` listener attached ONCE at the whole plan's root
// (DietTemplateView's own wrapper div), instead of a bespoke handler per
// content type. Every remarkable element carries its own `data-remark-key`
// (the exact same key its 🖍/💬 badge already uses); `.closest(
// '[data-remark-key]')` from wherever the selection actually landed finds
// the NEAREST one — a line inside a recipe resolves to that line's own key
// (more specific), while selecting the recipe's name/image/note (nothing
// closer tagged) falls back to the whole card's key, and so on for every
// other content type. Every remarkKey format embeds its own gear as the
// 2nd colon-delimited segment (`prefix:gear:...`), so gear is parsed back
// out of the matched key rather than needing a second data attribute
// threaded alongside it everywhere. `mouseup` (not `mouseover`/`click`) is
// the natural "a selection just finished" event; the selection is cleared
// right after raising so the browser doesn't leave a lingering blue
// selection band under the now-open comment modal.
function handleRemarkTextSelection(remarkCtx) {
  return () => {
    if (!remarkCtx || !remarkCtx.canRaise) return;
    const selection = window.getSelection();
    const text = selection && selection.toString().trim();
    if (!text || selection.isCollapsed) return;
    const anchorEl = selection.anchorNode && (selection.anchorNode.nodeType === 3 ? selection.anchorNode.parentElement : selection.anchorNode);
    const target = anchorEl && anchorEl.closest && anchorEl.closest('[data-remark-key]');
    if (!target) return;
    const key = target.getAttribute('data-remark-key');
    const gear = Number(key.split(':')[1]);
    selection.removeAllRanges();
    remarkCtx.onRaise(gear, key, text);
  };
}

// Reverse lookup for the "jump to this remark" flow (Diet Remarks page ->
// here): given a remarkKey, walks the same recipeGroups/subGroups/freeText
// structure the keys above are generated from to find which meal (gear) and
// which of that meal's own inner tabs (`schedule`/`group-N`) it lives on, so
// the caller can switch both before scrolling to it. Mirrors the exact
// iteration order used when rendering (group -> its own recipes/freeText ->
// its subGroups) so a match here is guaranteed to correspond to a real
// rendered block. Only numbered gears (2/3/4) ever carry a remark — General
// Guidelines' synthetic gear never does (see remarkCtx.canRaise gating below).
// A pending TL remark is keyed to a slot's CONTENT (recipe_id), not its
// position alone — so replacing or editing that slot's content changes what
// key the on-screen block computes to, and the remark would silently stop
// matching anything (its 💬 badge just disappears, even though it's still
// "pending" in the DB — see dietRemarksStore.js). Given a replace/edit
// target (which carries the exact groupHeading/subHeading/idx the ORIGINAL
// card was rendered with — see MealSection's onOpenReplace/onOpenEdit
// closures), this recomputes what the key was BEFORE and would be AFTER, so
// the caller (GearViewer's saveReplacement/editRecipe) can ask the server to
// carry the remark over onto the new content — same slot, same "pending"
// flag, until the coach explicitly resolves it.
function remarkRekeyFor(target, newRecipe) {
  if (!target || !target.groupHeading) return null;
  const oldKey = recipeRemarkKey(target.gear, target.groupHeading, target.subHeading, target.recipe, target.idx);
  const newKey = recipeRemarkKey(target.gear, target.groupHeading, target.subHeading, newRecipe, target.idx);
  return oldKey === newKey ? null : { oldKey, newKey };
}

// A recipeline: key is derived from its card's own key (see
// recipeLineRemarkKey above) — matches by trying every ingredient/step index
// that recipe actually has, rather than parsing the key string apart, so
// this can never drift from how the key was built in the first place.
function recipeHasLineKey(cardKey, recipe, remarkKey) {
  const ingredients = recipe.ingredients || [];
  for (let i = 0; i < ingredients.length; i++) {
    if (recipeLineRemarkKey(cardKey, 'ingredient', i) === remarkKey) return true;
  }
  const steps = recipe.steps || [];
  for (let i = 0; i < steps.length; i++) {
    if (recipeLineRemarkKey(cardKey, 'step', i) === remarkKey) return true;
  }
  return false;
}

function findRemarkLocation(allSections, remarkKey) {
  // Cover-page fields (Personal Details / Diet & Other Preference / Clinical
  // Details) render once at the top of the view regardless of which meal's
  // inner tab is active — so there's no tabId to switch to, just the gear
  // encoded in the key itself (cover:${gear}:${tableTitle}:${fieldKey}).
  if (remarkKey.startsWith('cover:')) {
    const gear = Number(remarkKey.split(':')[1]);
    return Number.isFinite(gear) ? { gear, tabId: null } : null;
  }
  const isLineKey = remarkKey.startsWith('recipeline:');
  for (const s of allSections) {
    if (typeof s.gear !== 'number') continue;
    const mealPlans = s.data.mealPlans || [];
    for (const plan of mealPlans) {
      for (let i = 0; i < (plan.rows || []).length; i++) {
        if (scheduleRowRemarkKey(s.gear, plan.title, i) === remarkKey) return { gear: s.gear, tabId: 'schedule' };
      }
    }
    const infoTables = s.data.infoTables || [];
    for (const table of infoTables) {
      for (let i = 0; i < (table.rows || []).length; i++) {
        if (infoRowRemarkKey(s.gear, table.title || 'table', i) === remarkKey) return { gear: s.gear, tabId: 'schedule' };
      }
    }
    for (let i = 0; i < (s.data.notes || []).length; i++) {
      if (noteRemarkKey(s.gear, i) === remarkKey) return { gear: s.gear, tabId: 'schedule' };
    }
    const groups = s.data.recipeGroups || [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const tabId = `group-${i}`;
      const recipes = group.recipes || [];
      for (let j = 0; j < recipes.length; j++) {
        const cardKey = recipeRemarkKey(s.gear, group.heading, null, recipes[j], j);
        if (cardKey === remarkKey) return { gear: s.gear, tabId };
        if (isLineKey && recipeHasLineKey(cardKey, recipes[j], remarkKey)) return { gear: s.gear, tabId };
      }
      const freeText = group.freeText || [];
      for (let j = 0; j < freeText.length; j++) {
        if (freeTextRemarkKey(s.gear, group.heading, j) === remarkKey) return { gear: s.gear, tabId };
      }
      for (const sub of (group.subGroups || [])) {
        const subRecipes = sub.recipes || [];
        for (let j = 0; j < subRecipes.length; j++) {
          const cardKey = recipeRemarkKey(s.gear, group.heading, sub.heading, subRecipes[j], j);
          if (cardKey === remarkKey) return { gear: s.gear, tabId };
          if (isLineKey && recipeHasLineKey(cardKey, subRecipes[j], remarkKey)) return { gear: s.gear, tabId };
        }
      }
    }
  }
  return null;
}

// A recipe card is one unit — image, ingredients and preparation always
// stay together, never split across separate cards or (in print) across a
// page break, so [Replace Recipe] always swaps one coherent whole.
//
// `recipe.originalRecipeId` is set only on a recipe that's CURRENTLY a
// replacement (see applyRecipeOverrides.js) — its presence is what shows the
// "replaced" tag and the Revert button, no separate tracking needed.
//
// `onRemove`, when given, means this card lives in the "Added Recipes" group
// (see MealSection below) — it gets a Remove button instead of Replace/Revert,
// since there's no original slot to replace and nothing to revert to.
//
// `onEdit`, unlike the others, is offered on EVERY card regardless of kind
// (original, replaced, or added) — a coach editing one line or swapping just
// the photo doesn't need "this is a real slot vs. an addition" to hold, the
// way Replace/Revert do (see GearViewer's editRecipe, which branches on that
// internally instead of pushing the distinction up into the UI).
// A line's own 💬 badge (view an existing pending remark) — never a 🖍 flag
// button here, since raising one happens by selecting its text (see
// handleRemarkTextSelection, attached once at the whole plan's root), not by
// clicking anything.
function RecipeLine({ text, cardKey, kind, index, remarkCtx, allergyTerms, dislikeTerms, foodRules, language }) {
  const key = recipeLineRemarkKey(cardKey, kind, index);
  const pending = remarkCtx && remarkCtx.pendingByKey.get(key);
  const remarkHighlight = pending && renderWithHighlight(text, pending.highlightedText, 'diet-remark-line-highlighted');
  const isHighlighted = !!pending && !remarkHighlight;
  return (
    <li id={`remark-${key}`} data-remark-key={remarkCtx ? key : undefined} className={isHighlighted ? 'diet-remark-line-highlighted' : undefined}>
      {pending && (
        <button
          type="button"
          className="diet-remark-badge diet-remark-line-badge"
          onClick={(e) => { e.stopPropagation(); remarkCtx.onOpen(pending); }}
          title={`TL remark from ${pending.raisedByName} — click to view`}
        >
          💬
        </button>
      )}
      {remarkHighlight || highlightFoodTerms(text, allergyTerms, dislikeTerms, foodRules, language)}
    </li>
  );
}

function Recipe({ recipe, onOpenReplace, onRevert, reverting, onRemove, removing, onEdit, remarkKey, remarkCtx, gear, allergyTerms, dislikeTerms, foodRules, language }) {
  const isReplaced = !!recipe.originalRecipeId;
  const isHighlighted = remarkCtx && remarkCtx.pendingByKey.has(remarkKey);
  return (
    <div id={`remark-${remarkKey}`} data-remark-key={remarkCtx ? remarkKey : undefined} className={`diet-recipe${isReplaced ? ' diet-recipe-replaced' : ''}${isHighlighted ? ' diet-recipe-remark-highlighted' : ''}`}>
      <RemarkFlag remarkKey={remarkKey} remarkCtx={remarkCtx} gear={gear} highlightedText={recipe.name} />
      {isReplaced && <span className="diet-recipe-replaced-tag">Replaced</span>}
      {recipe.aiGenerated && <span className="diet-recipe-unreviewed-tag">AI suggested — unreviewed</span>}
      {recipe.image && <AuthedImage className="diet-recipe-image" src={recipe.image} alt={recipe.name} />}
      <h4 className="diet-recipe-name">{highlightFoodTerms(recipe.name, allergyTerms, dislikeTerms, foodRules, language)}</h4>
      {!!(recipe.ingredients && recipe.ingredients.length) && (
        <div className="diet-recipe-block">
          <span className="diet-recipe-label">Ingredients{remarkCtx && remarkCtx.canRaise && <em className="diet-recipe-select-hint"> (select text to flag a line)</em>}</span>
          <ul>
            {recipe.ingredients.map((ing, i) => (
              <RecipeLine
                key={i} text={ing} cardKey={remarkKey} kind="ingredient" index={i} remarkCtx={remarkCtx}
                allergyTerms={allergyTerms} dislikeTerms={dislikeTerms} foodRules={foodRules} language={language}
              />
            ))}
          </ul>
        </div>
      )}
      {!!(recipe.steps && recipe.steps.length) && (
        <div className="diet-recipe-block">
          <span className="diet-recipe-label">Preparation{remarkCtx && remarkCtx.canRaise && <em className="diet-recipe-select-hint"> (select text to flag a line)</em>}</span>
          <ol>
            {recipe.steps.map((step, i) => (
              <RecipeLine
                key={i} text={step} cardKey={remarkKey} kind="step" index={i} remarkCtx={remarkCtx}
                allergyTerms={allergyTerms} dislikeTerms={dislikeTerms} foodRules={foodRules} language={language}
              />
            ))}
          </ol>
        </div>
      )}
      {recipe.note && <p className="diet-recipe-note">{highlightFoodTerms(recipe.note, allergyTerms, dislikeTerms, foodRules, language)}</p>}
      {(onOpenReplace || (isReplaced && onRevert) || onRemove || onEdit) && (
        <div className="diet-recipe-actions">
          {onEdit && (
            <button type="button" className="diet-recipe-edit-btn" onClick={() => onEdit(recipe)}>
              ✏️ Edit
            </button>
          )}
          {onOpenReplace && recipe.recipe_id && (
            <button type="button" className="diet-recipe-replace-btn" onClick={() => onOpenReplace(recipe)}>
              ⇄ Replace Recipe
            </button>
          )}
          {isReplaced && onRevert && (
            <button type="button" className="diet-recipe-revert-btn" disabled={reverting} onClick={() => onRevert(recipe)}>
              {reverting ? 'Reverting…' : '↩ Revert to original'}
            </button>
          )}
          {onRemove && (
            <button type="button" className="diet-recipe-remove-btn" disabled={removing} onClick={() => onRemove(recipe)}>
              {removing ? 'Removing…' : '🗑 Remove'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Diet Schedule content — read-only reference material, but a TL can still
// flag a wrong day's row just like a recipe card (see the highlight-mode
// toggle in DietTemplateView). One remark per row (the flag/badge sits in
// the row's own leading cell, `.diet-table-day`), but the HIGHLIGHT itself
// targets only whichever single cell actually contains the exact text the
// TL selected (renderWithHighlight) — never the whole row. `.diet-remark-
// row-highlighted` only still applies as a fallback, for a remark raised via
// the 🖍 flag button directly (no real selection to pinpoint) or one whose
// exact text no longer appears anywhere in this row.
// Click-to-edit wrapper for one Diet Schedule cell — Team Member accounts
// only (`editable`, threaded down from GearViewer's canEdit via
// onEditScheduleCell; a TL never gets one, same review-only convention as
// every recipe edit action). `value` is the cell's own plain string (what
// the input edits); `children` is what to show read-only (which may already
// be wrapped in a remark/allergy <mark> — see MealPlanTable/InfoTable
// below), so switching between the two never loses that highlighting.
function ScheduleCell({ value, editable, onSave, children }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const commit = async () => {
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="diet-schedule-cell-editing">
        <input
          className="diet-schedule-cell-input"
          value={draft}
          autoFocus
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === 'Escape') { setDraft(value); setError(null); setEditing(false); }
          }}
        />
        {error && <span className="diet-schedule-cell-error" title={error}>⚠</span>}
      </span>
    );
  }

  if (!editable) return children;

  return (
    <span
      className="diet-schedule-cell-editable"
      role="button"
      tabIndex={0}
      title="Click to edit"
      onClick={() => { setDraft(value); setEditing(true); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { setDraft(value); setEditing(true); } }}
    >
      {children}
    </span>
  );
}

function MealPlanTable({ plan, gear, remarkCtx, allergyTerms, dislikeTerms, foodRules, language, onEditScheduleCell }) {
  return (
    <div className="diet-mealplan">
      <h3 className="diet-mealplan-title">{plan.title}</h3>
      <div className="diet-table-wrap">
        <table className="diet-table">
          <thead>
            <tr>{plan.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {plan.rows.map((row, i) => {
              const key = scheduleRowRemarkKey(gear, plan.title, i);
              const pending = remarkCtx && remarkCtx.pendingByKey.get(key);
              const dayHighlight = pending && renderWithHighlight(row.day, pending.highlightedText, 'diet-remark-line-highlighted');
              const cellHighlights = row.cells.map((cell) => (pending && !dayHighlight ? renderWithHighlight(cell, pending.highlightedText, 'diet-remark-line-highlighted') : null));
              const rowFallbackHighlighted = pending && !dayHighlight && !cellHighlights.some(Boolean);
              return (
                <tr key={i} id={`remark-${key}`} data-remark-key={remarkCtx ? key : undefined} className={rowFallbackHighlighted ? 'diet-remark-row-highlighted' : undefined}>
                  <td className="diet-table-day">
                    <RemarkFlag remarkKey={key} remarkCtx={remarkCtx} gear={gear} highlightedText={`${plan.title} — ${row.day}`} />
                    <ScheduleCell
                      value={row.day}
                      editable={!!onEditScheduleCell}
                      onSave={(value) => onEditScheduleCell(gear, mealPlanTableKey(plan.title), i, 0, value)}
                    >
                      {dayHighlight || highlightFoodTerms(row.day, allergyTerms, dislikeTerms, foodRules, language)}
                    </ScheduleCell>
                  </td>
                  {row.cells.map((cell, j) => (
                    <td key={j}>
                      <ScheduleCell
                        value={cell}
                        editable={!!onEditScheduleCell}
                        onSave={(value) => onEditScheduleCell(gear, mealPlanTableKey(plan.title), i, j + 1, value)}
                      >
                        {cellHighlights[j] || highlightFoodTerms(cell, allergyTerms, dislikeTerms, foodRules, language)}
                      </ScheduleCell>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Non-day tables the source documents carry alongside the meal schedule —
// Gear 4's Do's and Don'ts, Restrict/Reduce/Replace, the daily routine. Same
// look as a meal plan, but its rows have no day column to pull the flag/
// badge into — added as a leading cell of its own instead. Same
// only-the-actually-selected-cell highlighting as MealPlanTable above,
// falling back to the whole row only when the remark's text can't be
// pinpointed to one cell (flag-button-raised, or since-edited content).
function InfoTable({ table, gear, remarkCtx, allergyTerms, dislikeTerms, foodRules, language, onEditScheduleCell }) {
  return (
    <div className="diet-mealplan">
      {table.title && <h3 className="diet-mealplan-title">{table.title}</h3>}
      <div className="diet-table-wrap">
        <table className="diet-table">
          <thead>
            <tr>{remarkCtx && <th className="diet-table-flag-col" />}{table.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => {
              const key = infoRowRemarkKey(gear, table.title || 'table', i);
              const pending = remarkCtx && remarkCtx.pendingByKey.get(key);
              const cellHighlights = row.map((cell) => (pending ? renderWithHighlight(cell, pending.highlightedText, 'diet-remark-line-highlighted') : null));
              const rowFallbackHighlighted = pending && !cellHighlights.some(Boolean);
              return (
                <tr key={i} id={`remark-${key}`} data-remark-key={remarkCtx ? key : undefined} className={rowFallbackHighlighted ? 'diet-remark-row-highlighted' : undefined}>
                  {remarkCtx && (
                    <td className="diet-table-flag-col">
                      <RemarkFlag remarkKey={key} remarkCtx={remarkCtx} gear={gear} highlightedText={row.join(' / ')} />
                    </td>
                  )}
                  {row.map((cell, j) => (
                    <td key={j}>
                      <ScheduleCell
                        value={cell}
                        editable={!!onEditScheduleCell}
                        onSave={(value) => onEditScheduleCell(gear, infoTableKey(table.title), i, j, value)}
                      >
                        {cellHighlights[j] || highlightFoodTerms(cell, allergyTerms, dislikeTerms, foodRules, language)}
                      </ScheduleCell>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// One meal's worth of the plan: its schedule table(s) plus its own recipe
// groups, behind its own inner tab row. `onOpenReplace`, if given, is called
// with (recipe, gear, mealType, dietType) whenever a card's own button is
// pressed — the actual modal lives once at the DietTemplateView level, not
// per-section, so replacing a recipe in one meal can't somehow interact with
// another meal's own open state.
function MealSection({
  section, active, onOpenReplace, onRevert, revertingId, onOpenAddRecipe, onRemoveRecipe, removingId,
  onOpenEdit, onRevertGroupAdditions, remarkCtx, activeTab, onTabChange, allergyTerms, dislikeTerms, foodRules, onEditScheduleCell,
  scheduleEditMode, onToggleScheduleEditMode,
}) {
  const { meta, mealPlans, infoTables, notes, scheduleImage, recipeGroups, closingQuote, disclaimer } = section.data;
  // This section's own language (a Tamil-language plan's recipes/schedule
  // are in Tamil script) — drives Tamil-translation matching in
  // highlightFoodTerms/countFoodTermMatches (see FoodHighlight.jsx).
  const language = meta && meta.language;
  const mealType = MEAL_TYPE_BY_GEAR[section.gear]; // undefined for General Guidelines — not a specific meal
  const groups = recipeGroups || [];
  const tabs = [
    { id: 'schedule', label: 'Diet Schedule' },
    ...groups.map((g, i) => ({ id: `group-${i}`, label: g.heading })),
  ];
  // Lifted to DietTemplateView (not local state here) so the "jump to this
  // remark" flow from the Diet Remarks page can switch straight to the tab a
  // highlighted block lives on before scrolling to it.
  const setActiveTab = onTabChange;
  // Which category tab is open right now, by NAME — "Recipes", "Herbal
  // Tea", "Kashayas", whatever the source document itself calls it. [+ Add
  // Recipe] appends to exactly this group (see GearViewer's addRecipe /
  // applyRecipeOverrides.js), so a recipe added while this tab is open
  // shows up on THIS tab, not a separate catch-all one.
  const activeGroupHeading = activeTab.startsWith('group-') ? groups[Number(activeTab.slice(6))]?.heading : null;

  return (
    <section className="diet-meal-panel" data-active={active} data-gear={section.gear}>
      <div className="diet-template-tabs diet-template-subtabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`diet-tab-btn${activeTab === t.id ? ' diet-tab-btn-active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {/* Team Member-only — edits Diet Schedule cells are opt-in, not
            always-on: without this toggle every cell would be click-to-edit
            all the time, which is one accidental click away from silently
            changing a patient's schedule while just reading it. Only shown
            on the Diet Schedule tab itself, where it's actually relevant. */}
        {onEditScheduleCell && activeTab === 'schedule' && (
          <button
            type="button"
            className={`diet-tab-btn diet-schedule-edit-btn${scheduleEditMode ? ' diet-schedule-edit-btn-active' : ''}`}
            onClick={onToggleScheduleEditMode}
          >
            {scheduleEditMode ? '✏️ Editing ON' : '✏️ Edit Diet Schedule'}
          </button>
        )}
        {/* Add/Remove act on recipe cards, which the Diet Schedule tab has
            none of — so these buttons (and every card's own Remove button)
            only ever appear once an actual recipe-group tab is open. */}
        {onOpenAddRecipe && activeTab !== 'schedule' && (
          <button
            type="button"
            className="diet-tab-btn diet-add-recipe-btn"
            onClick={() => onOpenAddRecipe(section.gear, mealType, meta.dietType, meta.language, activeGroupHeading)}
          >
            {`+ Add to "${activeGroupHeading}"`}
          </button>
        )}
        {onRevertGroupAdditions && activeTab !== 'schedule' && (
          <button
            type="button"
            className="diet-tab-btn diet-revert-group-btn"
            onClick={() => {
              if (window.confirm(`Remove every recipe added to "${activeGroupHeading}" for this meal? The original plan content here won't be affected.`)) {
                onRevertGroupAdditions(section.gear, activeGroupHeading);
              }
            }}
          >
            ↺ Revert Added
          </button>
        )}
      </div>

      {/* Names the meal in print, where the tab row is hidden. The id is
          what the Table of Contents' print-only page number targets via
          target-counter() — see TableOfContents above. */}
      <h2 id={`diet-section-${section.gear}`} className="diet-meal-print-heading">{section.mealLabel}</h2>

      {/* The meal tables were converted from the source document verbatim, but
          the recipes were extracted by rule and not yet checked against it —
          so say so rather than letting a draft read as verified. */}
      {meta && meta.recipesReviewed === false && (
        <p className="diet-draft-banner">
          Recipes in this section are an unreviewed automatic draft — check them against the
          source document before giving them to a patient. The meal schedule above is verbatim.
        </p>
      )}

      {/* Diet Schedule is read-only reference material, but — unlike
          [+ Add]/[Remove]/Replace, which genuinely have no meaning here
          (there's no recipe card to swap) — a TL CAN still flag a wrong
          day's row or a wrong note line, same highlight-mode toggle as the
          recipe tabs use. `[+ Add Recipe]`/`[↺ Revert Added]` stay
          conditioned on `activeTab !== 'schedule'` above regardless. */}
      <section className="diet-tab-panel" data-active={activeTab === 'schedule'} data-tab-id="schedule">
        {(mealPlans || []).map((plan, i) => (
          <MealPlanTable
            key={i} plan={plan} gear={section.gear} remarkCtx={remarkCtx}
            allergyTerms={allergyTerms} dislikeTerms={dislikeTerms} foodRules={foodRules} language={language}
            onEditScheduleCell={scheduleEditMode ? onEditScheduleCell : undefined}
          />
        ))}
        {(infoTables || []).map((t, i) => (
          <InfoTable
            key={i} table={t} gear={section.gear} remarkCtx={remarkCtx}
            allergyTerms={allergyTerms} dislikeTerms={dislikeTerms} foodRules={foodRules} language={language}
            onEditScheduleCell={scheduleEditMode ? onEditScheduleCell : undefined}
          />
        ))}
        {/* A diagram of the meal itself (Gear 2's "BMW BREAKFAST" plate —
            veggies/legumes/eggs/carbs by percentage), which explains the
            schedule table rather than any one dish, so it belongs here and
            not on a recipe card. Unlike .diet-group-image's decorative food
            photos it carries readable text, so .diet-schedule-image shows it
            whole instead of cropping it to a fixed-height thumbnail. */}
        {scheduleImage && <AuthedImage className="diet-schedule-image" src={scheduleImage} alt={`${section.mealLabel} plate composition`} />}
        {!!(notes && notes.length) && (
          <div className="diet-notes">
            {notes.map((n, i) => {
              const key = noteRemarkKey(section.gear, i);
              const pending = remarkCtx && remarkCtx.pendingByKey.get(key);
              const remarkHighlight = pending && renderWithHighlight(n, pending.highlightedText, 'diet-remark-line-highlighted');
              const isHighlighted = !!pending && !remarkHighlight;
              return (
                <p key={i} id={`remark-${key}`} data-remark-key={remarkCtx ? key : undefined} className={isHighlighted ? 'diet-remark-line-highlighted' : undefined}>
                  <RemarkFlag remarkKey={key} remarkCtx={remarkCtx} gear={section.gear} highlightedText={n} />
                  {remarkHighlight || highlightFoodTerms(n, allergyTerms, dislikeTerms, foodRules, language)}
                </p>
              );
            })}
          </div>
        )}
      </section>

      {groups.map((group, i) => {
        // Recipes in "Added Recipes" (see applyRecipeOverrides.js) get a
        // Remove button instead of Replace/Revert — there's no original
        // slot to swap or revert to, just an addition to undo.
        const isAddedGroup = group.heading === ADDED_RECIPES_HEADING;
        return (
        <section key={i} className="diet-tab-panel" data-active={activeTab === `group-${i}`} data-tab-id={`group-${i}`}>
          <div className="diet-recipe-group">
            {/* Repeats the tab's own label as a real heading inside the
                content — redundant on screen (the tab row right above
                already says which group is open), but load-bearing in
                print: every group tab starts its own printed page (see the
                @media print rule below), so without this a coach paging
                through the PDF would hit an unlabeled grid of recipe cards
                with no way to tell "Fruits" from "Herbal Tea" from "Salad
                Law" once the on-screen tabs are gone. */}
            <h3 className="diet-recipe-group-title">{group.heading}</h3>
            {/* A freeText-only group (Category 2/3, Cutting Types, Shop
                Organic Products, Salad Law, Water Law) has no recipe card to
                carry a photo, so it gets one directly on the group itself —
                its own source photo where the document had one, or (Salad
                Law/Water Law, which never do) the closest-matching real
                recipe photo in the corpus, picked at migration time. */}
            {group.image && <AuthedImage className="diet-group-image" src={group.image} alt={group.heading} />}
            {/* freeText renders before the recipe grid — it's lead-in context
                (Category 1's own "Category 1: Vitamins & Minerals - Salads"
                description) when a group has both, never trailing commentary. */}
            {!!(group.freeText && group.freeText.length) && (
              <div className="diet-freetext">
                {group.freeText.map((t, j) => {
                  const key = freeTextRemarkKey(section.gear, group.heading, j);
                  const isHighlighted = remarkCtx && remarkCtx.pendingByKey.has(key);
                  return (
                    <p key={j} id={`remark-${key}`} data-remark-key={remarkCtx ? key : undefined} className={isHighlighted ? 'diet-remark-line-highlighted' : undefined}>
                      <RemarkFlag remarkKey={key} remarkCtx={remarkCtx} gear={section.gear} highlightedText={t} />
                      <Linkify text={t} />
                    </p>
                  );
                })}
              </div>
            )}
            {!!(group.recipes && group.recipes.length) && (
              <div className="diet-recipe-grid">
                {chunkPairs(group.recipes).map((pair, pairIdx) => (
                  // Groups exactly 2 cards (or a lone leftover) into one
                  // print page-unit — see the .diet-recipe-page comment in
                  // App.css for why. Invisible on screen (`display:
                  // contents`): every card still flows directly into this
                  // same .diet-recipe-grid's normal responsive layout,
                  // unchanged from before pairing existed.
                  <div className="diet-recipe-page" key={pairIdx}>
                    {pair.map((r, j) => {
                      const idx = pairIdx * 2 + j;
                      return (
                        <Recipe
                          // Positional, not r.recipe_id: recipe_id is a content
                          // hash that legitimately recurs across different slots
                          // (the same dish can appear more than once in one plan,
                          // or a coach's replacement can coincidentally match
                          // another untouched recipe already in this group) — a
                          // content-based key silently collides when that happens,
                          // and React's list reconciliation then orphans a stale
                          // fiber on the next re-render (e.g. a revert), leaving
                          // one card frozen mid-action beside the correct new one
                          // instead of that one card flipping in place. Recipe has
                          // no internal state, so a plain positional key is safe.
                          key={idx}
                          recipe={r}
                          onOpenReplace={!isAddedGroup && onOpenReplace ? (recipe) => onOpenReplace(recipe, section.gear, mealType, meta.dietType, meta.language, group.heading, null, idx) : undefined}
                          onRevert={!isAddedGroup && onRevert ? (recipe) => onRevert(recipe, section.gear) : undefined}
                          reverting={revertingId === r.recipe_id}
                          onRemove={onRemoveRecipe ? (recipe) => onRemoveRecipe(recipe, section.gear) : undefined}
                          removing={removingId === r.recipe_id}
                          onEdit={onOpenEdit ? (recipe) => onOpenEdit(recipe, section.gear, group.heading, null, idx) : undefined}
                          remarkKey={recipeRemarkKey(section.gear, group.heading, null, r, idx)}
                          remarkCtx={remarkCtx}
                          gear={section.gear}
                          allergyTerms={allergyTerms}
                          dislikeTerms={dislikeTerms}
                          foodRules={foodRules}
                          language={language}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            {/* A group like "Dinner Recipe" has no recipes of its own — the
                source document nests Kanji / Thuvaiyal Recipes for Kanji /
                Millet Recipe underneath it instead, so each becomes its own
                labeled subsection here rather than a flat grid. */}
            {!!(group.subGroups && group.subGroups.length) && group.subGroups.map((sub, k) => (
              <div key={k} className="diet-recipe-subgroup">
                <h3 className="diet-recipe-subgroup-title">{sub.heading}</h3>
                <div className="diet-recipe-grid">
                  {chunkPairs(sub.recipes).map((pair, pairIdx) => (
                    <div className="diet-recipe-page" key={pairIdx}>
                      {pair.map((r, j) => {
                        const idx = pairIdx * 2 + j;
                        return (
                          <Recipe
                            // Same reasoning as the group.recipes key above.
                            key={idx}
                            recipe={r}
                            onOpenReplace={onOpenReplace && ((recipe) => onOpenReplace(recipe, section.gear, mealType, meta.dietType, meta.language, group.heading, sub.heading, idx))}
                            onRevert={onRevert && ((recipe) => onRevert(recipe, section.gear))}
                            reverting={revertingId === r.recipe_id}
                            onRemove={onRemoveRecipe ? (recipe) => onRemoveRecipe(recipe, section.gear) : undefined}
                            removing={removingId === r.recipe_id}
                            onEdit={onOpenEdit ? (recipe) => onOpenEdit(recipe, section.gear, group.heading, sub.heading, idx) : undefined}
                            remarkKey={recipeRemarkKey(section.gear, group.heading, sub.heading, r, idx)}
                            remarkCtx={remarkCtx}
                            gear={section.gear}
                            allergyTerms={allergyTerms}
                            dislikeTerms={dislikeTerms}
                            foodRules={foodRules}
                            language={language}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {/* Trailing guidance — read AFTER the recipes it qualifies, not
                before them: Gear 2's Salad Laws under the breakfast recipes,
                the Herbal Tea "Important Note" paragraphs under the tea
                options. A separate field from `freeText` rather than a
                position flag on it, because a group can legitimately have
                both (Category 1's one-line description still leads in, and
                Herbal Tea's "consumed in the evening" line stays on top
                while its Important Notes drop down here). This is the last
                thing in the panel, so it lands directly above the closing
                quote and disclaimer in .diet-template-footer below. */}
            {!!(group.footNotes && group.footNotes.length) && (
              <div className="diet-freetext diet-group-footnotes">
                {group.footNotes.map((t, j) => <p key={j}><Linkify text={t} /></p>)}
              </div>
            )}
          </div>
        </section>
        );
      })}

      {(closingQuote || disclaimer) && (
        <div className="diet-template-footer">
          {closingQuote && <p className="diet-template-quote">{closingQuote}</p>}
          {disclaimer && <p className="diet-template-disclaimer"><strong>Disclaimer: </strong>{disclaimer}</p>}
        </div>
      )}
    </section>
  );
}

// Every gear from the one opened up to Gear 4 gets fetched (see
// lib/gearChain.js's resolveGearChain — it always walks to LAST_GEAR
// regardless of the starting gear), so whenever a Gear 4 document exists for
// this condition its `generalGuidelines` is already sitting in `sections`
// even when Gear 4 itself isn't part of the meals being shown (e.g. viewing
// Gear 2). No extra fetch needed — just find it. Absent entirely when no
// Gear 4 document exists for this condition/diet/language at all.
function findGeneralGuidelines(sections) {
  const withIt = sections.find((s) => s.data.generalGuidelines);
  return withIt ? withIt.data.generalGuidelines : null;
}

// Wraps generalGuidelines in the same { gear, mealLabel, data } shape a
// resolved chain link has, so MealSection — built for a chain link — can
// render it unchanged rather than needing a second, near-duplicate renderer.
function generalGuidelinesSection(generalGuidelines) {
  return {
    gear: 'general-guidelines',
    mealLabel: 'General Guidelines',
    data: {
      meta: { title: generalGuidelines.title, tagline: generalGuidelines.tagline },
      mealPlans: generalGuidelines.mealPlans || [],
      infoTables: generalGuidelines.infoTables || [],
      notes: generalGuidelines.notes || [],
      recipeGroups: generalGuidelines.recipeGroups || [],
    },
  };
}

// Table of contents — every entry the management document's own TOC lists
// for whichever gear is open: each meal in the chain, then General
// Guidelines. Entries are generated from the resolved chain, never
// hardcoded, so a condition missing a later gear (or Gear 4 entirely) just
// produces a shorter list rather than a broken or invented entry. On screen
// an entry switches the active tab; in print each entry's page number comes
// from `target-counter()` against that section's own heading id — resolved
// by the browser's print layout at render time, never a stored number.
function TableOfContents({ allSections, activeId, onSelect }) {
  return (
    <nav className="diet-toc" aria-label="Table of contents">
      <h3 className="diet-toc-title">Table of Contents</h3>
      <ol className="diet-toc-list">
        {allSections.map((s) => (
          <li key={s.gear} className="diet-toc-item">
            <button
              type="button"
              className={`diet-toc-link${activeId === s.gear ? ' diet-toc-link-active' : ''}`}
              onClick={() => onSelect(s.gear)}
            >
              <span className="diet-toc-label">{s.data.meta.title || s.mealLabel}</span>
            </button>
            {/* Print-only page number. target-counter() reads this anchor's
                own href and asks the print engine which page that id landed
                on — computed at print time, never a stored number. Hidden on
                screen (App.css) since screen has no pages to number; the
                button above already handles on-screen navigation. */}
            <a className="diet-toc-pageno" href={`#diet-section-${s.gear}`} aria-hidden="true" tabIndex={-1} />
          </li>
        ))}
      </ol>
    </nav>
  );
}

// TL raises a remark on a block whose snapshot text (already resolved by
// the caller — the block's own name/day/line, not a DOM read) is shown
// read-only for confirmation, alongside the comment they're actually here
// to write.
function AddRemarkModal({ highlightedText, onSave, onClose }) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSave(comment.trim());
    } catch (err) {
      setError(err.message || String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div><h2>Highlight for the coach</h2></div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}
          <div className="diet-remark-snapshot">{highlightedText}</div>
          <label className="modal-field">
            <span className="modal-label">What's wrong, and what should change?</span>
            <textarea
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              autoFocus
              placeholder="e.g. Wrong quantity — should be 1/2 cup, not 1 cup."
            />
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="modal-cancel-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="modal-submit-btn" disabled={submitting || !comment.trim()}>
            {submitting ? 'Saving…' : '🖍 Highlight'}
          </button>
        </div>
      </form>
    </div>
  );
}

// Read by both roles — a coach reads it to see what to fix and resolve it;
// a TL reads back their own comment and, if they mis-flagged it, retracts
// it (only theirs — the server itself enforces that, see requireTL +
// dietRemarksStore.deleteRemark).
function ViewRemarkModal({ remark, isTL, onResolve, onDelete, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(err.message || String(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <h2>TL remark</h2>
            <p className="modal-subtitle">
              Raised by {remark.raisedByName} · {new Date(remark.createdAt).toLocaleString()}
              {remark.status === 'resolved' && ` · Resolved by ${remark.resolvedByName} · ${new Date(remark.resolvedAt).toLocaleString()}`}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}
          <div className="diet-remark-snapshot">{remark.highlightedText}</div>
          <p className="diet-remark-comment">{remark.comment}</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="modal-cancel-btn" onClick={onClose} disabled={busy}>Close</button>
          {isTL && remark.status === 'pending' && (
            <button type="button" className="diet-remark-retract-btn" disabled={busy} onClick={() => act(onDelete)}>
              🗑 Retract
            </button>
          )}
          {remark.status === 'pending' && (
            <button type="button" className="modal-submit-btn" disabled={busy} onClick={() => act(onResolve)}>
              {busy ? 'Saving…' : '✓ Mark Resolved'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DietTemplateView({
  sections, person, generatedAt, onDownloadPdf, onClose,
  onReplaceRecipe, onRevertRecipe, onAddRecipe, onRemoveRecipe, onEditRecipe, onRevertGroupAdditions, onRevertAllToOriginal,
  isTL, remarks, onRaiseRemark, onResolveRemark, onDeleteRemark, scrollToRemarkKey, personalDetailFields, dietPreferenceFields, clinicalDetailFields,
  onEditScheduleCell, foodRules,
}) {
  // The gear being viewed leads the chain, so its document supplies the
  // title — the later gears are meals appended to that same plan.
  const meta = sections[0].data.meta;
  const generalGuidelines = findGeneralGuidelines(sections);
  const allSections = generalGuidelines ? [...sections, generalGuidelinesSection(generalGuidelines)] : sections;
  const [activeMeal, setActiveMeal] = useState(sections[0].gear);
  // Allergy/dislike detection for the Diet Schedule tables (MealPlanTable/
  // InfoTable below) -- same free-text fields and term-splitting rules the
  // old .docx viewer's own highlighting already uses (see foodMatch.js), just
  // applied to this viewer's own plain-string table cells instead of parsed
  // docx-preview HTML (see FoodHighlight.jsx for why that's a separate, much
  // simpler implementation rather than a reuse of the old DOM-mutating one).
  const allergyTerms = useMemo(() => extractTerms(person && person.foodAllergy), [person]);
  const dislikeTerms = useMemo(() => extractTerms(person && person.dislikeFood), [person]);
  // Scanned across the WHOLE resolved plan — every meal's Diet Schedule AND
  // every recipe card (name/ingredients/steps/note), not just whichever tab
  // happens to be open — so this banner's count is always "how many matches
  // exist in this plan", not "...on the currently visible tab". Mirrors
  // findRemarkLocation's own whole-plan walk below. Each section's own
  // language (a Tamil-language plan's recipes are in Tamil script) drives
  // Tamil-translation matching via foodRules — see FoodHighlight.jsx.
  const foodWarningCount = useMemo(() => {
    if (!allergyTerms.length && !dislikeTerms.length) return 0;
    const countRecipe = (r, language) => (
      countFoodTermMatches(r.name, allergyTerms, dislikeTerms, foodRules, language)
      + (r.ingredients || []).reduce((sum, ing) => sum + countFoodTermMatches(ing, allergyTerms, dislikeTerms, foodRules, language), 0)
      + (r.steps || []).reduce((sum, step) => sum + countFoodTermMatches(step, allergyTerms, dislikeTerms, foodRules, language), 0)
      + (r.note ? countFoodTermMatches(r.note, allergyTerms, dislikeTerms, foodRules, language) : 0)
    );
    let count = 0;
    for (const s of allSections) {
      const { meta, mealPlans, infoTables, notes, recipeGroups } = s.data;
      const language = meta && meta.language;
      for (const plan of (mealPlans || [])) {
        for (const row of plan.rows) {
          count += countFoodTermMatches(row.day, allergyTerms, dislikeTerms, foodRules, language);
          for (const cell of row.cells) count += countFoodTermMatches(cell, allergyTerms, dislikeTerms, foodRules, language);
        }
      }
      for (const table of (infoTables || [])) {
        for (const row of table.rows) {
          for (const cell of row) count += countFoodTermMatches(cell, allergyTerms, dislikeTerms, foodRules, language);
        }
      }
      for (const note of (notes || [])) count += countFoodTermMatches(note, allergyTerms, dislikeTerms, foodRules, language);
      for (const group of (recipeGroups || [])) {
        for (const r of (group.recipes || [])) count += countRecipe(r, language);
        for (const sub of (group.subGroups || [])) {
          for (const r of (sub.recipes || [])) count += countRecipe(r, language);
        }
      }
    }
    return count;
  }, [allSections, allergyTerms, dislikeTerms, foodRules]);
  // Each meal's own inner tab (`schedule`/`group-N`), keyed by gear — lifted
  // up here (rather than local state inside MealSection) purely so the
  // scroll-to-remark effect below can switch a DIFFERENT meal's tab than
  // whichever happens to be on screen right now, from outside MealSection.
  const [activeGroupTabByGear, setActiveGroupTabByGear] = useState({});
  const getActiveTab = (gear) => activeGroupTabByGear[gear] ?? 'schedule';
  const setActiveTabForGear = (gear, tab) => setActiveGroupTabByGear((prev) => ({ ...prev, [gear]: tab }));

  // Up/Down-arrow navigation between every allergy/dislike <mark> in the
  // plan (foodWarningCount's own matches, in DOM order) — the whole plan's
  // marks are ALWAYS in the DOM regardless of which meal/tab is active (a
  // CSS display toggle, not conditional rendering — same convention every
  // other "every tab always rendered" comment in this file already notes),
  // so querying from the root ref finds them all, visible tab or not.
  const templateRef = useRef(null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  // The navigation LOGIC reads/writes this ref, never the `currentMatchIndex`
  // state variable above directly — state updates are batched/async, so two
  // arrow-key presses in the same tick (holding the key down, or a fast
  // double-tap) would both read the SAME stale `currentMatchIndex` and land
  // on the same "next" match instead of advancing twice. The ref is always
  // current the instant it's written; `currentMatchIndex` state exists
  // purely to re-render the banner's "X / N" count, kept in sync every call.
  const currentMatchIndexRef = useRef(-1);
  // Read via a ref (not a `goToFoodMatch` closure itself) inside the keydown
  // listener below, so that listener can be attached ONCE (keyed only on
  // whether there's anything to navigate at all) instead of being torn down
  // and re-attached on every single arrow-key press.
  const goToFoodMatchRef = useRef(() => {});
  goToFoodMatchRef.current = (direction) => {
    const root = templateRef.current;
    if (!root) return;
    const marks = Array.from(root.querySelectorAll('mark.food-flag'));
    if (!marks.length) return;
    const cur = currentMatchIndexRef.current;
    const next = cur === -1
      ? (direction > 0 ? 0 : marks.length - 1)
      : (cur + direction + marks.length) % marks.length;
    const mark = marks[next];
    // Same "switch to the right tab, then poll until it's actually laid out,
    // then scroll" shape as the remark jump-to effect below — a match deep
    // inside a currently-hidden meal/tab has zero size until its ancestor's
    // CSS display toggle flips, so scrolling to it immediately (before that
    // commits) would silently no-op.
    const mealPanel = mark.closest('.diet-meal-panel');
    const tabPanel = mark.closest('.diet-tab-panel');
    if (mealPanel && mealPanel.dataset.gear !== undefined) {
      const gearAttr = mealPanel.dataset.gear;
      const gear = /^\d+$/.test(gearAttr) ? Number(gearAttr) : gearAttr;
      setActiveMeal(gear);
      if (tabPanel && tabPanel.dataset.tabId) setActiveTabForGear(gear, tabPanel.dataset.tabId);
    }
    currentMatchIndexRef.current = next;
    setCurrentMatchIndex(next);
    let attempts = 0;
    const tryScroll = () => {
      attempts += 1;
      if (mark.offsetParent !== null) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        mark.classList.add('food-flag-current');
        setTimeout(() => mark.classList.remove('food-flag-current'), 1500);
        return;
      }
      if (attempts < 20) setTimeout(tryScroll, 50);
    };
    setTimeout(tryScroll, 0);
  };

  useEffect(() => {
    if (!foodWarningCount) return undefined;
    const handleKeyDown = (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      // Never hijack arrow keys while the user is actually typing/selecting
      // in a form field (the Diet Schedule cell editor, a modal's textarea,
      // the tracker's own search box elsewhere on the page, etc.) — those
      // need their normal cursor-movement behavior.
      const el = document.activeElement;
      const tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return;
      e.preventDefault();
      goToFoodMatchRef.current(e.key === 'ArrowDown' ? 1 : -1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [foodWarningCount]);
  // The one modal instance for the whole view, not one per section — which
  // recipe (if any) is currently being replaced, and enough context
  // (gear/mealType/dietType/language) to run the eligibility query and to
  // know which gear to persist the choice against. groupHeading/subHeading/
  // idx (the same position info recipeRemarkKey is built from) are carried
  // too, purely so the OLD and NEW remarkKey can both be computed once the
  // replacement is picked — see the "re-flag on edit/replace" comment below.
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [revertingId, setRevertingId] = useState(null);
  const [revertError, setRevertError] = useState(null);
  // Same shape as replaceTarget, for [✏️ Edit] — open on every recipe card
  // (original, replaced, or added), unlike Replace/Revert. Its own errors
  // are shown inline inside EditRecipeModal, same as Replace/Add above.
  const [editTarget, setEditTarget] = useState(null);
  // Same shape as replaceTarget, for [+ Add Recipe] — which meal (gear/
  // mealType/dietType/language) a new recipe is being added under.
  const [addTarget, setAddTarget] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [removeError, setRemoveError] = useState(null);
  const [revertingAll, setRevertingAll] = useState(false);
  // TL-only: while on, every remarkable block (recipe card, schedule row,
  // info row, freeText/note line) shows a 🖍 flag a TL can click to raise a
  // new remark on it — off by default so a TL just browsing the plan can't
  // accidentally start highlighting things.
  const [highlightMode, setHighlightMode] = useState(false);
  // Team Member-only (mirrors highlightMode's TL-only gating above): while
  // on, Diet Schedule cells become click-to-edit (see ScheduleCell). Off by
  // default so a coach just browsing the schedule can't accidentally start
  // editing it, and its own toggle button lives right next to the Diet
  // Schedule tab (see MealSection) rather than the global toolbar, since
  // editing is specifically a Diet Schedule thing, not a whole-plan mode.
  const [scheduleEditMode, setScheduleEditMode] = useState(false);
  // { gear, remarkKey, highlightedText } while [AddRemarkModal] is open.
  const [remarkAddTarget, setRemarkAddTarget] = useState(null);
  // The remark object [ViewRemarkModal] is currently showing (view/resolve/retract).
  const [remarkViewTarget, setRemarkViewTarget] = useState(null);

  // Every block-render site below looks up its own key in this map rather
  // than filtering `remarks` itself — built once per render, not per block.
  const pendingByKey = new Map((remarks || []).filter((r) => r.status === 'pending').map((r) => [r.remarkKey, r]));
  const remarkCtx = (isTL || onResolveRemark) ? {
    pendingByKey,
    canRaise: isTL && highlightMode,
    onRaise: (gear, remarkKey, highlightedText) => setRemarkAddTarget({ gear, remarkKey, highlightedText }),
    onOpen: (remark) => setRemarkViewTarget(remark),
  } : null;

  // Diet Remarks page -> here: land directly on the exact block a TL
  // highlighted, not just this patient's plan in general. Switches both the
  // outer meal tab and that meal's own inner group tab (both are CSS
  // display toggles, not conditional rendering — see MealSection's own
  // comment — so the target node already exists in the DOM either way, it's
  // just not laid out/visible until its tabs are made active), then scrolls
  // once that's actually reflected on screen.
  //
  // Polls for the element to become visible rather than assuming any fixed
  // delay is "enough" — measured directly: even a double
  // requestAnimationFrame after the setState calls above sometimes still ran
  // before React committed the tab-switch (or before the browser judged it
  // worth an animation frame at all — rAF can be throttled well beyond one
  // frame's worth of real time on a backgrounded/occluded tab), silently
  // no-opping scrollIntoView against a still-display:none ancestor.
  // offsetParent is null exactly when an ancestor is display:none, so it's
  // the right check for "has the tab switch actually painted yet", not just
  // "did some time pass". setTimeout, not requestAnimationFrame, for the
  // poll itself — it doesn't depend on a frame actually being rendered, so
  // it can't stall the same way. Capped at 20 tries (~1s) so a remarkKey
  // that somehow never becomes visible (stale data) doesn't poll forever.
  useEffect(() => {
    if (!scrollToRemarkKey) return undefined;
    const location = findRemarkLocation(allSections, scrollToRemarkKey);
    if (!location) return undefined;
    setActiveMeal(location.gear);
    if (location.tabId) setActiveTabForGear(location.gear, location.tabId);

    let timeoutId = null;
    let attempts = 0;
    const tryScroll = () => {
      const el = document.getElementById(`remark-${scrollToRemarkKey}`);
      attempts += 1;
      if (el && el.offsetParent !== null) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('diet-remark-jump-flash');
        setTimeout(() => el.classList.remove('diet-remark-jump-flash'), 2000);
        return;
      }
      if (attempts < 20) timeoutId = setTimeout(tryScroll, 50);
    };
    timeoutId = setTimeout(tryScroll, 0);
    return () => { if (timeoutId) clearTimeout(timeoutId); };
    // Only re-run when the target itself changes — allSections is stable per
    // patient/gear-chain load and recomputing the location on every unrelated
    // re-render (e.g. typing into an open modal) would re-trigger the scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToRemarkKey]);

  const handleRevert = async (recipe, gear) => {
    setRevertingId(recipe.recipe_id);
    setRevertError(null);
    try {
      await onRevertRecipe(gear, recipe);
    } catch (err) {
      setRevertError(err.message || String(err));
    } finally {
      setRevertingId(null);
    }
  };

  const handleRevertGroup = async (gear, groupHeading) => {
    setRevertError(null);
    try {
      await onRevertGroupAdditions(gear, groupHeading);
    } catch (err) {
      setRevertError(err.message || String(err));
    }
  };

  const handleRemove = async (recipe, gear) => {
    setRemovingId(recipe.recipe_id);
    setRemoveError(null);
    try {
      await onRemoveRecipe(gear, recipe);
    } catch (err) {
      setRemoveError(err.message || String(err));
    } finally {
      setRemovingId(null);
    }
  };

  const handleRevertAll = async () => {
    if (!window.confirm('Revert this whole diet plan back to its original, unedited content? Every added/replaced recipe and every edited Diet Schedule cell across every meal in this plan will be reverted.')) return;
    setRevertingAll(true);
    setRevertError(null);
    try {
      await onRevertAllToOriginal();
    } catch (err) {
      setRevertError(err.message || String(err));
    } finally {
      setRevertingAll(false);
    }
  };

  return (
    // onMouseUp here (not per-content-type) is what makes select-text-to-
    // highlight work for every remarkable block in the plan uniformly — see
    // handleRemarkTextSelection's own comment. A no-op function when
    // remarkCtx is absent/not in highlight mode, so this costs nothing for a
    // coach just reading the plan.
    <div className="diet-template" ref={templateRef} onMouseUp={handleRemarkTextSelection(remarkCtx)}>
      <div className="diet-template-toolbar">
        <div>
          <h1 className="diet-template-title">{meta.title}</h1>
          {meta.tagline && <p className="diet-template-tagline">{meta.tagline}</p>}
        </div>
        <div className="diet-template-toolbar-actions">
          {isTL && (
            <button
              type="button"
              className={`diet-template-highlight-btn${highlightMode ? ' diet-template-highlight-btn-active' : ''}`}
              onClick={() => setHighlightMode((v) => !v)}
              title="Toggle highlight mode to flag mistakes for the coach"
            >
              {highlightMode ? '🖍 Highlighting ON' : '🖍 Highlight Mode'}
            </button>
          )}
          {onRevertAllToOriginal && (
            <button type="button" className="diet-template-revert-all-btn" disabled={revertingAll} onClick={handleRevertAll}>
              {revertingAll ? 'Reverting…' : '↺ Revert to Original'}
            </button>
          )}
          <button type="button" className="diet-template-pdf-btn" onClick={onDownloadPdf}>⬇ Download as PDF</button>
          {onClose && <button type="button" className="diet-template-close-btn" onClick={onClose} aria-label="Close">×</button>}
        </div>
      </div>

      {/* mealLabels covers only the meal chain (never General Guidelines,
          which isn't a meal) — Gear 2's cover reads "Breakfast + Lunch +
          Dinner", not just its own leading section's label, since that's
          what Gear 2 actually contains. */}
      <PatientCoverPage
        person={person}
        generatedAt={generatedAt}
        gear={sections[0].gear}
        mealLabels={sections.map((s) => s.mealLabel)}
        personalDetailFields={personalDetailFields}
        dietPreferenceFields={dietPreferenceFields}
        clinicalDetailFields={clinicalDetailFields}
        remarkCtx={remarkCtx}
      />

      {foodWarningCount > 0 && (
        <div className="diet-food-warning-banner">
          ⚠ This plan's recipes and Diet Schedule mention {foodWarningCount} item{foodWarningCount === 1 ? '' : 's'} matching
          {' '}{person.name || 'this patient'}'s reported allergy/dislike — check the highlighted items below before sharing.
        </div>
      )}

      {/* A fixed-position floating panel, deliberately OUTSIDE .diet-template's
          own scroll container (see .diet-food-finder in App.css) rather than
          living inside the banner above — it needs to stay reachable/visible
          no matter how far the coach has scrolled into a long plan, the same
          reason a browser's own find-in-page toolbar floats instead of
          scrolling away with the page. ↑/↓ (see the keydown effect above)
          drive the exact same navigation these buttons do. */}
      {foodWarningCount > 0 && (
        <div className="diet-food-finder">
          <span className="diet-food-finder-title">Allergy &amp; Dislike Finder</span>
          <div className="diet-food-finder-controls">
            <button type="button" onClick={() => goToFoodMatchRef.current(-1)} title="Previous match (↑)" aria-label="Previous match">▲</button>
            <span className="diet-food-finder-count">{currentMatchIndex === -1 ? '–' : currentMatchIndex + 1} / {foodWarningCount}</span>
            <button type="button" onClick={() => goToFoodMatchRef.current(1)} title="Next match (↓)" aria-label="Next match">▼</button>
          </div>
        </div>
      )}

      <TableOfContents allSections={allSections} activeId={activeMeal} onSelect={setActiveMeal} />

      <div className="diet-template-tabs diet-template-mealtabs">
        {allSections.map((s) => (
          <button
            key={s.gear}
            type="button"
            className={`diet-meal-btn${activeMeal === s.gear ? ' diet-meal-btn-active' : ''}`}
            onClick={() => setActiveMeal(s.gear)}
          >
            {s.mealLabel}
          </button>
        ))}
      </div>

      <div className="diet-template-print-root">
        {allSections.map((s) => (
          <MealSection
            key={s.gear}
            section={s}
            active={activeMeal === s.gear}
            activeTab={getActiveTab(s.gear)}
            onTabChange={(tab) => setActiveTabForGear(s.gear, tab)}
            // Only real meal gears (2/3/4) are replaceable — General
            // Guidelines' synthetic "gear" isn't a number the server can
            // save an override against, and in practice carries no recipes
            // anyway (see server/diet-data/schema.md).
            onOpenReplace={onReplaceRecipe && typeof s.gear === 'number'
              ? (recipe, gear, mealType, dietType, language, groupHeading, subHeading, idx) =>
                setReplaceTarget({ recipe, gear, mealType, dietType, language, groupHeading, subHeading, idx })
              : undefined}
            onRevert={onRevertRecipe && typeof s.gear === 'number' ? handleRevert : undefined}
            revertingId={revertingId}
            onOpenAddRecipe={onAddRecipe && typeof s.gear === 'number'
              ? (gear, mealType, dietType, language, groupHeading) => setAddTarget({ gear, mealType, dietType, language, groupHeading })
              : undefined}
            onRemoveRecipe={onRemoveRecipe && typeof s.gear === 'number' ? handleRemove : undefined}
            removingId={removingId}
            onOpenEdit={onEditRecipe && typeof s.gear === 'number'
              ? (recipe, gear, groupHeading, subHeading, idx) => setEditTarget({ recipe, gear, groupHeading, subHeading, idx })
              : undefined}
            onRevertGroupAdditions={onRevertGroupAdditions && typeof s.gear === 'number' ? handleRevertGroup : undefined}
            // General Guidelines' synthetic gear can't be raised against
            // (the server needs a real numeric gear to save a remark row) —
            // still shows any existing badge, just never a fresh 🖍 flag.
            remarkCtx={remarkCtx ? { ...remarkCtx, canRaise: remarkCtx.canRaise && typeof s.gear === 'number' } : null}
            allergyTerms={allergyTerms}
            dislikeTerms={dislikeTerms}
            foodRules={foodRules}
            onEditScheduleCell={onEditScheduleCell && typeof s.gear === 'number' ? onEditScheduleCell : undefined}
            scheduleEditMode={scheduleEditMode}
            onToggleScheduleEditMode={() => setScheduleEditMode((v) => !v)}
          />
        ))}
      </div>

      {revertError && (
        <div className="diet-revert-error-banner">
          Could not revert: {revertError}
          <button type="button" onClick={() => setRevertError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {removeError && (
        <div className="diet-revert-error-banner">
          Could not remove: {removeError}
          <button type="button" onClick={() => setRemoveError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {replaceTarget && (
        <RecipeReplaceModal
          recipe={replaceTarget.recipe}
          mealType={replaceTarget.mealType}
          dietType={replaceTarget.dietType}
          person={{ ...person, vegPreference: replaceTarget.dietType || person.vegPreference, language: replaceTarget.language || person.language }}
          onClose={() => setReplaceTarget(null)}
          onSelect={async (newRecipe) => {
            await onReplaceRecipe(replaceTarget.gear, replaceTarget.recipe, newRecipe, remarkRekeyFor(replaceTarget, newRecipe));
            setReplaceTarget(null);
          }}
        />
      )}

      {editTarget && (
        <EditRecipeModal
          recipe={editTarget.recipe}
          onClose={() => setEditTarget(null)}
          onSave={async (editedRecipe) => {
            await onEditRecipe(editTarget.gear, editTarget.recipe, editedRecipe, remarkRekeyFor(editTarget, editedRecipe));
            setEditTarget(null);
          }}
        />
      )}

      {addTarget && (
        <AddRecipeModal
          gear={addTarget.gear}
          mealType={addTarget.mealType}
          dietType={addTarget.dietType}
          language={addTarget.language}
          groupHeading={addTarget.groupHeading}
          person={person}
          onClose={() => setAddTarget(null)}
          onAdd={async (newRecipe) => {
            await onAddRecipe(addTarget.gear, newRecipe, addTarget.groupHeading);
            setAddTarget(null);
          }}
        />
      )}

      {remarkAddTarget && (
        <AddRemarkModal
          highlightedText={remarkAddTarget.highlightedText}
          onClose={() => setRemarkAddTarget(null)}
          onSave={async (comment) => {
            await onRaiseRemark(remarkAddTarget.gear, remarkAddTarget.remarkKey, remarkAddTarget.highlightedText, comment);
            setRemarkAddTarget(null);
          }}
        />
      )}

      {remarkViewTarget && (
        <ViewRemarkModal
          remark={remarkViewTarget}
          isTL={isTL}
          onClose={() => setRemarkViewTarget(null)}
          onResolve={() => onResolveRemark(remarkViewTarget.id)}
          onDelete={() => onDeleteRemark(remarkViewTarget.id)}
        />
      )}
    </div>
  );
}

export default DietTemplateView;
