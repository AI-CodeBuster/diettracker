// [+ Add Recipe] picker — opened from a meal's own tab row in DietTemplateView
// (not from an existing Recipe card: nothing is being replaced, this appends a
// wholly new recipe to that meal's "Added Recipes" group). Two ways to add, as
// tabs, deliberately mirroring [Replace Recipe]'s own (see RecipeReplaceModal,
// whose AlternativeCard/ManualEntryTab this reuses directly):
//   - From Library: browse/search/filter the WHOLE cross-condition recipe
//     library (server/lib/recipeEligibility.js). Unlike [Replace] — which
//     auto-derives its filters from the one slot being swapped and has no
//     search box at all — there's no single slot's context to narrow
//     against here, so the coach searches by name and filters by condition
//     and gear themselves. Diet type/language/allergy safety still apply
//     automatically underneath, same non-negotiable filters [Replace] uses,
//     just never exposed as something to turn off.
//   - Enter Manually: identical to [Replace]'s own tab.
// Both end up calling the same onAdd(recipe) — the parent (DietTemplateView ->
// GearViewer's addRecipe) persists it the same way regardless of which tab
// produced it.
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiFetch';
import { AlternativeCard, ManualEntryTab } from './RecipeReplaceModal';
import { CONDITION_LABELS } from '../lib/labels';
import { detectPersonCondition } from '../lib/matchDiet';

const GEAR_OPTIONS = [
  { gear: 2, mealType: 'breakfast', label: 'Gear 2 · Breakfast' },
  { gear: 3, mealType: 'lunch', label: 'Gear 3 · Lunch' },
  { gear: 4, mealType: 'dinner', label: 'Gear 4 · Dinner' },
];

function LibraryBrowseTab({ gear, person, onSelect, selecting }) {
  const [search, setSearch] = useState('');
  // Defaults to the patient's OWN detected condition (same auto-scoping
  // [Replace Recipe]'s LibraryTab already does via free-text conditionText)
  // instead of "Any condition" — a coach can still widen it from the
  // dropdown below. Lazy initializer: only computed once, when this tab
  // first mounts for this gear/patient (the modal itself remounts fresh
  // every time it's opened — see DietTemplateView's addTarget/replaceTarget
  // state — so this always reflects whichever patient/gear is current).
  const [condition, setCondition] = useState(() => detectPersonCondition(person).conditions[0] || '');
  const [gearFilter, setGearFilter] = useState(gear);
  const [state, setState] = useState({ status: 'loading', items: [], total: 0, excludedForAllergy: 0 });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, status: 'loading' }));
    const mealType = (GEAR_OPTIONS.find((g) => g.gear === gearFilter) || {}).mealType;
    const params = new URLSearchParams({
      search,
      mealType: mealType || '',
      dietType: person.vegPreference || '',
      language: person.language || '',
      conditionText: condition,
      allergyText: person.foodAllergy || '',
      dislikeText: person.dislikeFood || '',
      limit: '40',
    });
    apiFetch(`/api/recipe-alternatives?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Server returned ${r.status}`))))
      .then((data) => { if (!cancelled) setState({ status: 'ready', ...data }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', items: [], total: 0, excludedForAllergy: 0, message: err.message }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, condition, gearFilter]);

  return (
    <>
      <div className="diet-add-filters">
        <label className="modal-field">
          <span className="modal-label">Search by name</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Idli, Poriyal, Kashayam" />
        </label>
        <label className="modal-field">
          <span className="modal-label">Condition</span>
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">Any condition</option>
            {Object.entries(CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="modal-field">
          <span className="modal-label">Gear / meal</span>
          <select value={gearFilter} onChange={(e) => setGearFilter(Number(e.target.value))}>
            {GEAR_OPTIONS.map((g) => <option key={g.gear} value={g.gear}>{g.label}</option>)}
          </select>
        </label>
      </div>

      {state.status === 'loading' && <p className="panel-status">Searching the library…</p>}
      {state.status === 'error' && <div className="error-banner">Could not load recipes: {state.message}</div>}
      {state.status === 'ready' && (
        <>
          <p className="modal-hint">
            {state.items.length} of {state.total} matching recipe{state.total === 1 ? '' : 's'} shown
            {state.excludedForAllergy ? ` (${state.excludedForAllergy} hidden for ${person.foodAllergy} allergy)` : ''}.
            Unreviewed drafts are flagged — check them against the source before using with a patient.
          </p>
          {!state.items.length && (
            <p className="profile-empty-note">No recipes match this search/filter combination.</p>
          )}
          <div className="diet-recipe-grid">
            {state.items.map((alt) => (
              <AlternativeCard key={alt.recipe_id} recipe={alt} busy={selecting === alt.recipe_id} onSelect={onSelect} actionLabel="+ Add this recipe" />
            ))}
          </div>
        </>
      )}
    </>
  );
}

const TABS = [
  { id: 'library', label: 'From Library' },
  { id: 'manual', label: 'Enter Manually' },
];

function AddRecipeModal({ gear, mealType, dietType, language, person, onAdd, onClose }) {
  const [tab, setTab] = useState('library');
  const [selecting, setSelecting] = useState(null);
  const [error, setError] = useState(null);

  // dietType/language are the values the meal being viewed actually resolved
  // to (may differ from the person's own raw fields — see DietTemplateView),
  // so the library search stays consistent with what's on screen.
  const scopedPerson = { ...person, vegPreference: dietType || person.vegPreference, language: language || person.language };

  const handleAdd = async (recipe) => {
    setSelecting(recipe.recipe_id);
    setError(null);
    try {
      await onAdd(recipe);
    } catch (err) {
      setError(err.message || String(err));
      setSelecting(null);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card diet-replace-modal">
        <div className="modal-header">
          <div>
            <h2>Add a recipe</h2>
            <p className="modal-subtitle">{mealType ? `Added to this meal's "Added Recipes" section` : 'Added to "Added Recipes"'}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="diet-replace-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`diet-tab-btn${tab === t.id ? ' diet-tab-btn-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}

          {tab === 'library' && (
            <LibraryBrowseTab gear={gear} person={scopedPerson} onSelect={handleAdd} selecting={selecting} />
          )}
          {tab === 'manual' && (
            <ManualEntryTab
              onSelect={handleAdd}
              selecting={selecting}
              mealType={mealType}
              dietType={dietType || person.vegPreference}
              language={language || person.language}
              conditionText={person.conditionRaw}
            />
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-cancel-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default AddRecipeModal;
