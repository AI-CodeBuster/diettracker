// Shared recipe-library browsing UI — search box, one-value-per-field
// filters (Condition/Gear/Category/Language/Added, live-filtering, no
// submit step) and the result grid, plus its own [+ Add recipe]. Used
// IDENTICALLY by two hosts, deliberately the same component rather than two
// look-alikes that could drift apart:
//   - The standalone sidebar Library (LibraryPage.jsx) — unrestricted,
//     patient-agnostic browsing: no dietType/allergyText, no initial
//     filters, no onSelect (cards are informational only).
//   - DietTemplateView's [+ Add Recipe] picker, "From Library" tab
//     (AddRecipeModal.jsx) — pick mode: dietType/allergyText scope the
//     fetch to what's SAFE for this patient (see GET /api/recipe-library-
//     full's own comment — the same non-negotiable hard filter [Add]/
//     [Replace] Recipe always applied, just never exposed as a pill),
//     initialConditionFilter/initialGearFilter default the visible filters
//     to this patient/gear without preventing the coach from widening them,
//     and onSelect turns each card's "+ Add this recipe" button into
//     applying it to the patient's plan instead of nothing.
// Because both hosts read the SAME /api/recipe-library-full, a recipe added
// from a patient's plan shows up in the sidebar, and a recipe added from
// the sidebar (or from THIS component's own [+ Add recipe] while embedded
// in a patient's plan) is immediately pickable for any other patient too.
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/apiFetch';
import AuthedImage from './AuthedImage';
import AddLibraryRecipeModal from './AddLibraryRecipeModal';
import { CONDITION_LABELS, LANGUAGE_LABELS, LIBRARY_CATEGORY_OPTIONS, LIBRARY_GEAR_OPTIONS } from '../lib/labels';
import { DATE_RANGE_OPTIONS, matchesDateRange, formatAddedAt } from '../lib/dateRange';

// A recipe's `conditions` can carry a comorbid compound tag (e.g.
// "BP+GASTRIC" — see server/lib/recipeEligibility.js's own baseCondition),
// so filtering on the base condition is what actually matches how these
// were tagged, same reasoning as that engine's own conditionMatches.
function baseConditions(recipe) {
  return (recipe.conditions || []).map((c) => c.split('+')[0]);
}

// One value per field, not multi — a plain <select>, so picking a new value
// always replaces whatever was chosen before. `placeholder` renders as its
// own leading "Any ..." option representing "no filter"; the Added row
// omits it since DATE_RANGE_OPTIONS already starts with "Any time" as a
// real option, not a separate cleared state. `parse` converts the always-
// stringy DOM value back to whatever type the filter actually compares
// against (Gear's options are numbers — see RecipeLibraryBrowser's own
// `.includes(gearFilter)` checks below, which would silently never match
// against a string "2").
function FilterSelect({ label, options, value, onChange, renderOption, placeholder, parse = (v) => v }) {
  return (
    <label className="modal-field">
      <span className="modal-label">{label}</span>
      <select value={value} onChange={(e) => onChange(parse(e.target.value))}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt} value={opt}>{renderOption ? renderOption(opt) : opt}</option>
        ))}
      </select>
    </label>
  );
}

// onSelect present = pick mode (embedded in a patient's plan): the card
// grows a "+ Add this recipe" button. Absent = pure browsing (the sidebar
// Library): the card is informational only, same as before.
function LibraryRecipeCard({ recipe, onSelect, selecting }) {
  return (
    <div className="diet-recipe diet-recipe-alt">
      {/* lazy: the whole point of the grid this card sits in — see
          AuthedImage's own comment on why this is opt-in and why THIS is
          exactly the place it's needed (hundreds of cards can mount at
          once here, unlike anywhere else AuthedImage is used). */}
      {recipe.image && <AuthedImage className="diet-recipe-image" src={recipe.image} alt={recipe.name} lazy />}
      <h4 className="diet-recipe-name">{recipe.name}</h4>
      {!recipe.reviewed && <span className="diet-recipe-unreviewed-tag">Unreviewed draft</span>}

      <div className="library-recipe-meta">
        {(recipe.conditions || []).map((c) => (
          <span key={c} className="library-tag library-tag-condition">{CONDITION_LABELS[c.split('+')[0]] || c}</span>
        ))}
        {(recipe.gear || []).map((g) => <span key={g} className="library-tag library-tag-gear">Gear {g}</span>)}
        {(recipe.categories || []).map((cat) => <span key={cat} className="library-tag library-tag-category">{cat}</span>)}
        {recipe.language && <span className="library-tag library-tag-language">{LANGUAGE_LABELS[recipe.language] || recipe.language}</span>}
      </div>

      {!!(recipe.ingredients && recipe.ingredients.length) && (
        <div className="diet-recipe-block">
          <span className="diet-recipe-label">Ingredients</span>
          <ul>{recipe.ingredients.map((ing, i) => <li key={i}>{ing}</li>)}</ul>
        </div>
      )}
      {!!(recipe.steps && recipe.steps.length) && (
        <div className="diet-recipe-block">
          <span className="diet-recipe-label">Preparation</span>
          <ol>{recipe.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
        </div>
      )}

      <p className="library-recipe-added">
        Added {formatAddedAt(recipe.addedAt)}{recipe.addedByName ? ` by ${recipe.addedByName}` : ''}
      </p>

      {onSelect && (
        <div className="diet-recipe-actions">
          <button type="button" className="diet-recipe-select-btn" disabled={selecting === recipe.recipe_id} onClick={() => onSelect(recipe)}>
            {selecting === recipe.recipe_id ? 'Saving…' : '+ Add this recipe'}
          </button>
        </div>
      )}
    </div>
  );
}

function RecipeLibraryBrowser({
  dietType, allergyText,
  initialConditionFilter = '', initialGearFilter = '',
  onSelect, selecting,
}) {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  // One value per field, not a list — see FilterSelect's own comment.
  const [conditionFilter, setConditionFilter] = useState(initialConditionFilter);
  const [gearFilter, setGearFilter] = useState(initialGearFilter);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);

  // dietType/allergyText are the only params sent server-side (the hard
  // patient-safety filter — see this file's own top comment); everything
  // else is fetched once and filtered live on the client below, same as
  // the plain sidebar Library always has.
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (dietType) params.set('dietType', dietType);
    if (allergyText) params.set('allergyText', allergyText);
    const qs = params.toString();
    apiFetch(`/api/recipe-library-full${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.error || `Server returned ${r.status}`)))))
      .then((data) => setRecipes(data.recipes || []))
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dietType, allergyText]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (conditionFilter && !baseConditions(r).includes(conditionFilter)) return false;
      if (gearFilter && !(r.gear || []).includes(gearFilter)) return false;
      if (categoryFilter && !(r.categories || []).includes(categoryFilter)) return false;
      if (languageFilter && r.language !== languageFilter) return false;
      if (!matchesDateRange(r.addedAt, dateRange)) return false;
      return true;
    });
  }, [recipes, search, conditionFilter, gearFilter, categoryFilter, languageFilter, dateRange]);

  const hasActiveFilters = !!(search || conditionFilter || gearFilter || categoryFilter || languageFilter || dateRange !== 'all');
  const clearFilters = () => {
    setSearch('');
    setConditionFilter('');
    setGearFilter('');
    setCategoryFilter('');
    setLanguageFilter('');
    setDateRange('all');
  };

  return (
    <div className="library-browser">
      <div className="issues-controls">
        <div className="issues-search">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipe name"
          />
          {search && (
            <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label="Clear search">×</button>
          )}
        </div>
        {hasActiveFilters && (
          <button type="button" className="modal-cancel-btn" onClick={clearFilters}>Clear filters</button>
        )}
        <button type="button" className="issues-raise-btn" onClick={() => setShowAddModal(true)}>
          + Add recipe
        </button>
      </div>

      <div className="diet-add-filters">
        <FilterSelect
          label="Condition"
          options={Object.keys(CONDITION_LABELS)}
          value={conditionFilter}
          onChange={setConditionFilter}
          renderOption={(c) => CONDITION_LABELS[c]}
          placeholder="Any condition"
        />
        <FilterSelect
          label="Gear"
          options={LIBRARY_GEAR_OPTIONS}
          value={gearFilter}
          onChange={setGearFilter}
          renderOption={(g) => `Gear ${g}`}
          placeholder="Any gear"
          parse={(v) => (v === '' ? '' : Number(v))}
        />
        <FilterSelect
          label="Category"
          options={LIBRARY_CATEGORY_OPTIONS}
          value={categoryFilter}
          onChange={setCategoryFilter}
          placeholder="Any category"
        />
        <FilterSelect
          label="Language"
          options={Object.keys(LANGUAGE_LABELS)}
          value={languageFilter}
          onChange={setLanguageFilter}
          renderOption={(l) => LANGUAGE_LABELS[l]}
          placeholder="Any language"
        />
        <FilterSelect
          label="Added"
          options={DATE_RANGE_OPTIONS.map((o) => o.key)}
          value={dateRange}
          onChange={setDateRange}
          renderOption={(key) => DATE_RANGE_OPTIONS.find((o) => o.key === key).label}
        />
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="loading-banner">Loading…</div>}

      {!loading && !error && (
        <p className="modal-hint">{filtered.length} of {recipes.length} recipes shown.</p>
      )}

      {!loading && !error && !filtered.length && (
        <p className="empty-state">No recipes match this search/filter combination.</p>
      )}

      {!loading && !error && !!filtered.length && (
        <div className="diet-recipe-grid">
          {filtered.map((r) => <LibraryRecipeCard key={r.recipe_id} recipe={r} onSelect={onSelect} selecting={selecting} />)}
        </div>
      )}

      {showAddModal && (
        <AddLibraryRecipeModal
          onClose={() => setShowAddModal(false)}
          onAdded={(recipe) => {
            setRecipes((list) => [recipe, ...list]);
            setShowAddModal(false);
            // Pick mode: a recipe just typed in here is exactly what the
            // coach was looking for (that's why they hit [+ Add recipe]
            // mid-search) — apply it to the patient's plan immediately
            // instead of making them find their own new card and click
            // "+ Add this recipe" a second time.
            if (onSelect) onSelect(recipe);
          }}
        />
      )}
    </div>
  );
}

export default RecipeLibraryBrowser;
