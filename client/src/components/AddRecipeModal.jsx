// [+ Add Recipe] picker — opened from a meal's own tab row in DietTemplateView
// (not from an existing Recipe card: nothing is being replaced, this appends a
// wholly new recipe to that meal's "Added Recipes" group). Two ways to add,
// as tabs:
//   - From Library: the SAME RecipeLibraryBrowser component the sidebar
//     "Recipe Library" section uses (see that component's own top comment)
//     — identical filters (Condition/Gear/Category/Language/Added, one
//     value per field, live), identical cards, and its own [+ Add recipe]
//     for typing a brand-new one without leaving this picker. Diet type/
//     allergy safety still apply automatically underneath (dietType/
//     allergyText passed to RecipeLibraryBrowser, enforced server-side —
//     see GET /api/recipe-library-full), same non-negotiable filter
//     [Replace] uses, just never exposed as something to turn off. Gear/
//     Condition default to this patient/gear (a coach can still widen
//     them) via initialGearFilter/initialConditionFilter.
//   - Enter Manually: identical to [Replace]'s own tab (RecipeReplaceModal's
//     ManualEntryTab) — a quicker one-off entry that skips the Library's
//     own condition/gear/category tagging in favor of auto-deriving them
//     from the patient/meal already open.
// Both end up calling the same onAdd(recipe) — the parent (DietTemplateView ->
// GearViewer's addRecipe) persists it the same way regardless of which tab
// (or which of RecipeLibraryBrowser's own two ways in) produced it.
import { useState } from 'react';
import { ManualEntryTab } from './RecipeReplaceModal';
import RecipeLibraryBrowser from './RecipeLibraryBrowser';
import { detectPersonCondition } from '../lib/matchDiet';

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
  const scopedDietType = dietType || person.vegPreference;

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
            <RecipeLibraryBrowser
              dietType={scopedDietType}
              allergyText={person.foodAllergy}
              initialConditionFilter={detectPersonCondition(person).conditions[0] || ''}
              initialGearFilter={gear}
              onSelect={handleAdd}
              selecting={selecting}
            />
          )}
          {tab === 'manual' && (
            <ManualEntryTab
              onSelect={handleAdd}
              selecting={selecting}
              mealType={mealType}
              dietType={scopedDietType}
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
