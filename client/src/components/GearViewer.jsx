// Decides which diet-plan renderer to use for a given person+gear: the new
// data-driven DietTemplateView if every gear in the chain has been migrated
// (see server/diet-data/index.json), or the existing .docx-based
// DietViewerPanel otherwise. Reuses matchDietOptions — the same matching
// logic the old viewer already runs — purely to read which manifest entries
// it would pick; nothing about that matching is duplicated or reimplemented
// here, just called again (cheap: it's a pure function over data already in
// memory) so this decision can be made before committing to either renderer.
//
// The chain, not the single gear, is what gets checked: a gear's document is
// only one meal (Gear 2 = Breakfast, Gear 3 = Lunch, Gear 4 = Dinner), so a
// Gear 2 plan needs Gears 2, 3 and 4 to render Breakfast + Lunch + Dinner.
// If any link is unmigrated the whole chain falls back to DietViewerPanel,
// which already chains the .docx files — better a consistent old view than a
// new one silently missing the patient's lunch and dinner.
//
// Also resolves this patient's saved recipe replacements (diet_recipe_
// overrides, see server/lib/recipeOverrideStore.js) and splices them into
// each gear's data before rendering — the same "fetch fresh, apply on top"
// pattern the old .docx viewer already uses for its own text-splice
// overrides, just for a recipe-content swap instead of a text one. A saved
// override carries its FULL replacement content (not just an id — see
// server/index.js's isValidRecipeOverrides comment for why), so applying one
// is a synchronous local merge, no extra fetch needed on load.
import { useEffect, useState } from 'react';
import DietViewerPanel from './DietViewerPanel';
import DietTemplateView from './DietTemplateView';
import { resolveGearChain } from '../lib/gearChain';
import { apiFetch } from '../lib/apiFetch';
import { patientKey } from '../lib/patientKey';
import { applyRecipeOverrides, ADDED_RECIPES_HEADING } from '../lib/applyRecipeOverrides';
import { applyScheduleOverrides } from '../lib/applyScheduleOverrides';
import { detectPersonCondition } from '../lib/matchDiet';
import { CONDITION_LABELS } from '../lib/labels';

// A saved override is one of three kinds — split once here so both call
// sites below (initial load, re-derive after a save) apply each kind
// through its own path instead of every caller re-checking the shape:
//   - REPLACEMENT: { originalRecipeId, recipe } — swaps that slot's content.
//   - ADDITION: { recipe } (no originalRecipeId) — a wholly new recipe, see
//     [+ Add Recipe] / applyRecipeOverrides.js.
//   - REMOVAL: { originalRecipeId, removed: true } (no recipe) — see
//     [Remove] below; drops that slot from the plan entirely.
function splitOverrides(rawOverrides) {
  const replacements = new Map();
  const additions = [];
  const removedIds = new Set();
  for (const o of rawOverrides || []) {
    if (o.removed) { removedIds.add(o.originalRecipeId); continue; }
    if (o.originalRecipeId) replacements.set(o.originalRecipeId, o.recipe);
    else additions.push({ recipe: o.recipe, groupHeading: o.groupHeading });
  }
  return { replacements, additions, removedIds };
}

// Shared by the initial load and both persist paths below (recipe AND
// schedule saves each re-derive a gear's sections from a fresh template
// fetch — see persistOverrides/persistScheduleOverrides) — applies BOTH
// override layers together every time, since either one changing means the
// on-screen data for that gear has to be rebuilt from the pristine template
// up, not patched in place.
function deriveSectionData(freshData, recipeOverridesForGear, scheduleOverridesForGear) {
  const { replacements, additions, removedIds } = splitOverrides(recipeOverridesForGear);
  const withRecipes = applyRecipeOverrides(freshData, replacements, additions, removedIds);
  return applyScheduleOverrides(withRecipes, scheduleOverridesForGear);
}

function GearViewer({ person, gear, manifestFiles, foodRules, sheetName, onClose, fullscreen, onToggleFullscreen, isTL, canEdit, scrollToRemarkKey }) {
  const chain = resolveGearChain(manifestFiles, person, gear);
  const chainKey = chain.map((c) => c.entry.id).join(',');
  const personKey = patientKey(sheetName, person);
  // undefined = still checking; array = every gear migrated; null = at least one isn't
  const [sections, setSections] = useState(chain.length ? undefined : null);
  // { [gear]: [{ originalRecipeId, recipe }] } — the raw saved pairs, kept
  // separately from `sections` so a replacement/revert can be persisted and
  // re-applied without re-fetching the underlying diet-template JSON.
  const [rawOverrides, setRawOverrides] = useState({});
  // { [gear]: [{ tableKey, rowIndex, colIndex, value }] } — same idea as
  // rawOverrides above, for Diet Schedule cell edits (see
  // applyScheduleOverrides.js / scheduleOverrideStore.js).
  const [rawScheduleOverrides, setRawScheduleOverrides] = useState({});
  // Every TL-raised remark across every gear for this patient (see Diet
  // Remarks) — fetched once alongside sections/overrides, kept as its own
  // piece of state since raising/resolving one never needs a template
  // re-fetch the way a recipe override does.
  const [remarks, setRemarks] = useState([]);
  // Which Personal Details fields to show on the cover page — a global
  // config (see "Patient Details Edit" / server/lib/patientDetailFieldsStore.js),
  // not per-patient, but fetched here alongside everything else so
  // PatientCoverPage stays a pure, prop-driven component rather than doing
  // its own fetch. undefined until loaded — PatientCoverPage falls back to
  // its own default field list in that case, same as before this existed.
  const [personalDetailFieldKeys, setPersonalDetailFieldKeys] = useState(undefined);
  const [dietPreferenceFieldKeys, setDietPreferenceFieldKeys] = useState(undefined);
  const [clinicalDetailFieldKeys, setClinicalDetailFieldKeys] = useState(undefined);

  useEffect(() => {
    if (!chain.length) { setSections(null); return; }
    setSections(undefined);
    let cancelled = false;

    Promise.all([
      Promise.all(
        chain.map((link) =>
          apiFetch(`/api/diet-template/${encodeURIComponent(link.entry.id)}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
            .then((data) => (data ? { ...link, data } : null)),
        ),
      ),
      apiFetch(`/api/patient-data/${encodeURIComponent(personKey)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      apiFetch(`/api/diet-remarks/patient/${encodeURIComponent(personKey)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      apiFetch('/api/patient-detail-fields')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([resolved, patientData, remarksData, fieldsData]) => {
        if (cancelled) return;
        if (!resolved.every(Boolean)) { setSections(null); return; }
        const overrideGears = (patientData && patientData.recipeOverrideGears) || {};
        const scheduleOverrideGears = (patientData && patientData.scheduleOverrideGears) || {};
        setRawOverrides(overrideGears);
        setRawScheduleOverrides(scheduleOverrideGears);
        setRemarks((remarksData && remarksData.remarks) || []);
        setPersonalDetailFieldKeys(fieldsData && fieldsData.fields && fieldsData.fields.personal);
        setDietPreferenceFieldKeys(fieldsData && fieldsData.fields && fieldsData.fields.dietPreference);
        setClinicalDetailFieldKeys(fieldsData && fieldsData.fields && fieldsData.fields.clinicalDetails);
        setSections(resolved.map((link) => ({
          ...link,
          data: deriveSectionData(link.data, overrideGears[String(link.gear)], scheduleOverrideGears[String(link.gear)]),
        })));
      })
      .catch(() => { if (!cancelled) setSections(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey, personKey]);

  // Shared by both save paths below: persist `nextForGear` as the new
  // overrides list for `saveGear`, then re-derive `sections` from the raw
  // per-gear diet-template data each section already carries — re-applying
  // ALL of that gear's current overrides fresh, not just patching the one
  // that changed, so replace-then-revert-a-different-recipe can never leave
  // a stale swap behind.
  const persistOverrides = async (saveGear, nextForGear) => {
    // TEMPORARY diagnostic logging (see the "Add Recipe" bug report) — safe
    // to remove once that's confirmed fixed. Open the browser console
    // (F12) and look for these "[diet-remarks-debug]"-free "[persist]"
    // lines when reproducing.
    console.log('[persistOverrides] saving gear', saveGear, 'overrides:', nextForGear);
    const res = await apiFetch(`/api/patient-data/${encodeURIComponent(personKey)}/gear/${saveGear}/recipe-overrides`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: nextForGear }),
    });
    console.log('[persistOverrides] PUT response status:', res.status);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error('[persistOverrides] PUT failed:', body);
      throw new Error(body.error || 'Could not save changes');
    }

    setRawOverrides((prev) => ({ ...prev, [String(saveGear)]: nextForGear }));
    // sections doesn't carry the ORIGINAL (pre-override) data once a swap
    // has been applied once, so a second change to the same gear re-fetches
    // that one gear's template fresh rather than layering a merge on a
    // merge — simplest way to guarantee revert always gets back to the true
    // original, however many replacements happened first.
    //
    // Both steps below used to fail SILENTLY (a plain `return`) on the
    // (expected-rare) chance the gear wasn't in `chain` or the re-fetch
    // 404'd — which meant a save that actually succeeded server-side could
    // still look like "nothing happened" on screen, with no error anywhere
    // to explain why. Throwing instead means the modal that called this
    // shows a real error, rather than silently discarding a saved change.
    const link = chain.find((c) => c.gear === saveGear);
    if (!link) throw new Error(`Gear ${saveGear} isn't part of this plan's chain — could not refresh the view.`);
    const fresh = await apiFetch(`/api/diet-template/${encodeURIComponent(link.entry.id)}`).then((r) => (r.ok ? r.json() : null));
    if (!fresh) throw new Error('Saved, but could not reload the plan to show it — try closing and reopening this gear.');
    console.log('[persistOverrides] re-applying overrides for gear', saveGear);
    setSections((prev) => {
      const next = prev
        ? prev.map((s) => (s.gear === saveGear
          ? { ...s, data: deriveSectionData(fresh, nextForGear, rawScheduleOverrides[String(saveGear)]) }
          : s))
        : prev;
      console.log('[persistOverrides] new sections for gear', saveGear, ':', next && next.find((s) => s.gear === saveGear));
      return next;
    });
  };

  // Diet Schedule cell edits — Team Member accounts only (see App.jsx's
  // canEdit / GearViewer's own onEditScheduleCell wiring below). Mirrors
  // persistOverrides above exactly (save, re-fetch that gear's pristine
  // template fresh, re-derive sections from BOTH override layers together),
  // just against the schedule-overrides table/key shape instead of the
  // recipe one.
  const persistScheduleOverrides = async (saveGear, nextForGear) => {
    const res = await apiFetch(`/api/patient-data/${encodeURIComponent(personKey)}/gear/${saveGear}/schedule-overrides`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: nextForGear }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Could not save the edit');
    }
    setRawScheduleOverrides((prev) => ({ ...prev, [String(saveGear)]: nextForGear }));
    const link = chain.find((c) => c.gear === saveGear);
    if (!link) throw new Error(`Gear ${saveGear} isn't part of this plan's chain — could not refresh the view.`);
    const fresh = await apiFetch(`/api/diet-template/${encodeURIComponent(link.entry.id)}`).then((r) => (r.ok ? r.json() : null));
    if (!fresh) throw new Error('Saved, but could not reload the plan to show it — try closing and reopening this gear.');
    setSections((prev) => (prev
      ? prev.map((s) => (s.gear === saveGear
        ? { ...s, data: deriveSectionData(fresh, rawOverrides[String(saveGear)], nextForGear) }
        : s))
      : prev));
  };

  // One cell's new value, keyed by which table/row/column it lives in (see
  // applyScheduleOverrides.js's mealPlanTableKey/infoTableKey — the same
  // builders DietTemplateView.jsx uses when calling this, so the key always
  // matches). Replaces any existing edit to that exact cell rather than
  // stacking a second entry for it.
  const editScheduleCell = async (saveGear, tableKey, rowIndex, colIndex, value) => {
    const current = rawScheduleOverrides[String(saveGear)] || [];
    const next = [
      ...current.filter((o) => !(o.tableKey === tableKey && o.rowIndex === rowIndex && o.colIndex === colIndex)),
      { tableKey, rowIndex, colIndex, value },
    ];
    await persistScheduleOverrides(saveGear, next);
  };

  // Shared by saveReplacement and editRecipe below: if the slot being changed
  // currently carries a PENDING TL remark (see Diet Remarks), moves that
  // remark's own stored key onto the NEW content so its 💬 badge/highlight
  // keeps showing — same "still pending" flag, now on the new content —
  // until the coach clicks Mark Resolved. Without this, a pending remark's
  // key (built from the slot's recipe_id — see DietTemplateView's
  // recipeRemarkKey) simply stops matching anything the instant that slot's
  // content changes, silently dropping the visible flag while the remark
  // itself is still "pending" underneath. remarkRekey is {oldKey, newKey} or
  // null (see DietTemplateView's remarkRekeyFor — null when nothing to move,
  // e.g. this slot never had a pending remark, or the "edit" didn't actually
  // change the block identity).
  const maybeRekeyRemark = async (remarkRekey) => {
    if (!remarkRekey) return;
    const { oldKey, newKey } = remarkRekey;
    const pending = remarks.find((r) => r.remarkKey === oldKey && r.status === 'pending');
    if (!pending) return;
    try {
      const res = await apiFetch(`/api/diet-remarks/${pending.id}/rekey`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newRemarkKey: newKey }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not carry the highlight over');
      const updated = await res.json();
      setRemarks((prev) => prev.map((r) => (r.id === pending.id ? updated : r)));
    } catch (err) {
      // Best-effort — the edit/replace itself already succeeded (the thing
      // that must not be lost); losing the highlight's carry-over just means
      // the remark still exists (visible on the Diet Remarks page) but no
      // longer visually attached to this slot, not silent data loss.
      console.error('Could not re-key diet remark after edit/replace:', err);
    }
  };

  // originalRecipe is the recipe CURRENTLY in that slot (which may itself
  // already be a previous replacement — its own `recipe_id` is what the new
  // override keys against, so replacing an already-replaced recipe just
  // updates that same slot rather than stacking overrides).
  const saveReplacement = async (saveGear, originalRecipe, newRecipe, remarkRekey) => {
    const current = rawOverrides[String(saveGear)] || [];
    const keyId = originalRecipe.originalRecipeId || originalRecipe.recipe_id;
    const next = [
      ...current.filter((o) => o.originalRecipeId !== keyId),
      { originalRecipeId: keyId, recipe: newRecipe },
    ];
    await persistOverrides(saveGear, next);
    await maybeRekeyRemark(remarkRekey);
  };

  // [✏️ Edit] — offered on every card (original, replaced, or added), unlike
  // Replace/Revert. Under the hood this is the SAME override mechanism as
  // Replace — coach-authored content simply IS the new content for that
  // slot — except for an ADDED recipe (no original slot to key against, same
  // isPureAddition check removeRecipe below already uses), where the edit
  // has to update that addition's own entry in place instead: a
  // {originalRecipeId, recipe} replacement would target a slot that doesn't
  // exist in the pristine template data and would silently never apply.
  const editRecipe = async (saveGear, recipe, editedRecipe, remarkRekey) => {
    const current = rawOverrides[String(saveGear)] || [];
    const isAddition = !recipe.originalRecipeId
      && current.some((o) => !o.originalRecipeId && !o.removed && o.recipe && o.recipe.recipe_id === recipe.recipe_id);
    const next = isAddition
      ? current.map((o) => (!o.originalRecipeId && !o.removed && o.recipe && o.recipe.recipe_id === recipe.recipe_id
        ? { ...o, recipe: editedRecipe }
        : o))
      : [
        ...current.filter((o) => o.originalRecipeId !== (recipe.originalRecipeId || recipe.recipe_id)),
        { originalRecipeId: recipe.originalRecipeId || recipe.recipe_id, recipe: editedRecipe },
      ];
    await persistOverrides(saveGear, next);
    await maybeRekeyRemark(remarkRekey);
  };

  // Drops the override for this slot, so the next re-derive (inside
  // persistOverrides) falls back to that gear's true original content —
  // never needs the original fetched separately, since it's simply what's
  // already in the un-overridden diet-template data.
  const revertReplacement = async (saveGear, recipe) => {
    const keyId = recipe.originalRecipeId;
    if (!keyId) return; // nothing to revert — this recipe was never replaced
    const current = rawOverrides[String(saveGear)] || [];
    const next = current.filter((o) => o.originalRecipeId !== keyId);
    await persistOverrides(saveGear, next);
  };

  // [+ Add Recipe] — appends a wholly new recipe (from the library, an AI
  // suggestion, or typed by hand) to whichever category tab (Recipes,
  // Herbal Tea, Kashayas...) was actually open when the coach clicked it —
  // `groupHeading` names that tab; applyRecipeOverrides.js falls back to a
  // generic "Added Recipes" bucket only if it's ever missing. No
  // originalRecipeId: that's what tells splitOverrides/the server this is
  // an addition, not a replacement.
  const addRecipe = async (saveGear, recipe, groupHeading) => {
    const current = rawOverrides[String(saveGear)] || [];
    await persistOverrides(saveGear, [...current, { recipe, groupHeading }]);
  };

  // [↺ Revert Added] — beside [+ Add Recipe]: undoes every addition made to
  // THIS ONE category tab, leaving both the original content and any other
  // tab's own additions untouched. A no-op (persists the same list) if this
  // tab has no additions yet — simpler than tracking per-tab counts just to
  // decide whether to show the button.
  const revertAdditionsInGroup = async (saveGear, groupHeading) => {
    const current = rawOverrides[String(saveGear)] || [];
    const next = current.filter((o) => o.originalRecipeId || o.removed || (o.groupHeading || ADDED_RECIPES_HEADING) !== groupHeading);
    await persistOverrides(saveGear, next);
  };

  // [Remove] — available on every recipe card, not just added ones. Two
  // different things happen depending on what's actually being removed:
  //   - A dietitian-added recipe (see [+ Add Recipe]) has no original slot
  //     at all — removing it just drops its own addition entry outright.
  //   - Any other card (an original source recipe, or one currently
  //     replaced) DOES have a real slot — recorded as a REMOVAL override
  //     against that slot's true original id (recipe.originalRecipeId when
  //     it's a replacement, else its own recipe_id), replacing whatever
  //     override (if any) was there, so the slot renders as gone rather
  //     than reverting to its source content.
  const removeRecipe = async (saveGear, recipe) => {
    const current = rawOverrides[String(saveGear)] || [];
    const isPureAddition = !recipe.originalRecipeId
      && current.some((o) => !o.originalRecipeId && !o.removed && o.recipe && o.recipe.recipe_id === recipe.recipe_id);
    if (isPureAddition) {
      const next = current.filter((o) => !(!o.originalRecipeId && !o.removed && o.recipe && o.recipe.recipe_id === recipe.recipe_id));
      await persistOverrides(saveGear, next);
      return;
    }
    const keyId = recipe.originalRecipeId || recipe.recipe_id;
    const next = [...current.filter((o) => o.originalRecipeId !== keyId), { originalRecipeId: keyId, removed: true }];
    await persistOverrides(saveGear, next);
  };

  // [Revert to Original] — wipes every saved customization (replacements
  // AND additions) across the WHOLE chain being viewed, not just the one
  // gear on screen: a Gear 2 download already spans Breakfast/Lunch/Dinner,
  // so "the diet plan" a coach means by this button is that whole merged
  // plan, not just whichever meal tab happens to be open. Runs the same
  // persistOverrides([]) path per gear as every other save here — no
  // separate server route needed, an empty overrides list already means
  // "nothing customized" to writeRecipeOverride.
  const revertAllToOriginal = async () => {
    await Promise.all(chain.map((link) => Promise.all([
      persistOverrides(link.gear, []),
      persistScheduleOverrides(link.gear, []),
    ])));
  };

  // Diet Remarks: a TL highlights one block of the plan and leaves a
  // comment (see server/lib/dietRemarksStore.js) — patient/coach/batch/
  // condition are a snapshot taken at raise time, not derived live, since
  // the cross-patient "Diet Remarks" panel needs them even when a different
  // sheet than this one is the active one.
  const raiseRemark = async (raiseGear, remarkKey, highlightedText, comment) => {
    const detected = person ? detectPersonCondition(person) : null;
    const conditionLabel = detected ? CONDITION_LABELS[detected.conditions[0]] + (detected.comorbid ? ' + Gastric/Ulcer/Acidity' : '') : '';
    const res = await apiFetch('/api/diet-remarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personKey,
        gear: raiseGear,
        remarkKey,
        highlightedText,
        comment,
        patientName: person.name || '',
        healthCoachName: person.hcName || '',
        batch: person.batch || '',
        conditionLabel,
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save the highlight');
    const remark = await res.json();
    setRemarks((prev) => [remark, ...prev]);
    return remark;
  };

  // Either action a signed-in user can take on an existing remark: the
  // coach resolving it once fixed, or the TL who raised it retracting a
  // mis-flagged one (the server itself enforces "only the TL who raised
  // this one" for retract — see requireTL + dietRemarksStore.deleteRemark).
  const resolveRemarkAction = async (id) => {
    const res = await apiFetch(`/api/diet-remarks/${id}/resolve`, { method: 'PUT' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not mark resolved');
    const updated = await res.json();
    setRemarks((prev) => prev.map((r) => (r.id === id ? updated : r)));
  };

  const deleteRemarkAction = async (id) => {
    const res = await apiFetch(`/api/diet-remarks/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not retract the highlight');
    setRemarks((prev) => prev.filter((r) => r.id !== id));
  };

  if (sections === undefined) {
    return (
      <div className="panel">
        <header className="panel-header">
          <div>
            <h2>Gear {gear} Diet Plan</h2>
            <p className="panel-subtitle">{person.name}{person.studentId ? ` · #${person.studentId}` : ''}</p>
          </div>
          <div className="panel-header-actions">
            <button className="panel-close" onClick={onClose} type="button" aria-label="Close">×</button>
          </div>
        </header>
        <div className="panel-body-wrap"><div className="panel-body"><div className="panel-status">Loading…</div></div></div>
      </div>
    );
  }

  if (sections) {
    return (
      <DietTemplateView
        sections={sections}
        person={person}
        generatedAt={new Date().toLocaleDateString()}
        onDownloadPdf={() => window.print()}
        onClose={onClose}
        // A TL's account is a review-only tool inside a diet plan — highlight
        // and download, nothing that changes the plan's actual content. Every
        // edit action below is simply not passed down when canEdit is false,
        // which is all DietTemplateView needs: each of its buttons already
        // renders only when its own callback prop is present.
        onReplaceRecipe={canEdit ? saveReplacement : undefined}
        onRevertRecipe={canEdit ? revertReplacement : undefined}
        onAddRecipe={canEdit ? addRecipe : undefined}
        onRemoveRecipe={canEdit ? removeRecipe : undefined}
        onEditRecipe={canEdit ? editRecipe : undefined}
        onRevertGroupAdditions={canEdit ? revertAdditionsInGroup : undefined}
        onRevertAllToOriginal={canEdit ? revertAllToOriginal : undefined}
        onEditScheduleCell={canEdit ? editScheduleCell : undefined}
        foodRules={foodRules}
        isTL={isTL}
        remarks={remarks}
        onRaiseRemark={raiseRemark}
        onResolveRemark={resolveRemarkAction}
        onDeleteRemark={deleteRemarkAction}
        scrollToRemarkKey={scrollToRemarkKey}
        personalDetailFields={personalDetailFieldKeys}
        dietPreferenceFields={dietPreferenceFieldKeys}
        clinicalDetailFields={clinicalDetailFieldKeys}
      />
    );
  }

  return (
    <DietViewerPanel
      person={person}
      gear={gear}
      manifestFiles={manifestFiles}
      foodRules={foodRules}
      sheetName={sheetName}
      onClose={onClose}
      fullscreen={fullscreen}
      onToggleFullscreen={onToggleFullscreen}
    />
  );
}

export default GearViewer;
