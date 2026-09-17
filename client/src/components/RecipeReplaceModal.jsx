// [Replace Recipe] picker — opened from a Recipe card in DietTemplateView.
// Three ways to pick a replacement, as tabs:
//   - From Library: the server's eligibility engine (server/lib/
//     recipeEligibility.js) searches the whole cross-condition recipe
//     library for compatible alternatives.
//   - AI Suggestion: Gemini generates one recipe considering the patient's
//     condition/diet/language/allergies (server/lib/geminiRecipeSuggest.js).
//   - Enter Manually: the dietitian types a recipe from scratch and
//     optionally uploads its photo.
// All three end up calling the SAME `onSelect(recipe)` with the same recipe
// shape ({name, ingredients, steps, image?, recipe_id}), so the parent
// (DietTemplateView -> GearViewer's saveReplacement) never needs to know
// which tab produced it.
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiFetch';
import AuthedImage from './AuthedImage';
import { CONDITION_LABELS } from '../lib/labels';

// Exported for AddRecipeModal, which reuses this exact card (and
// ManualEntryTab below) for its own "From Library"/"Enter Manually" tabs —
// same shape, same styling, just a different actionLabel and a different
// final destination for onSelect's recipe (an addition instead of a swap).
export function AlternativeCard({ recipe, onSelect, busy, actionLabel }) {
  return (
    <div className="diet-recipe diet-recipe-alt">
      {recipe.image && <AuthedImage className="diet-recipe-image" src={recipe.image} alt={recipe.name} />}
      <h4 className="diet-recipe-name">{recipe.name}</h4>
      {!recipe.reviewed && <span className="diet-recipe-unreviewed-tag">{recipe.aiGenerated ? 'AI suggested — unreviewed' : 'Unreviewed draft'}</span>}
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
      <button type="button" className="diet-recipe-select-btn" disabled={busy} onClick={() => onSelect(recipe)}>
        {busy ? 'Saving…' : (actionLabel || 'Select')}
      </button>
    </div>
  );
}

function LibraryTab({ recipe, mealType, dietType, person, onSelect, selecting }) {
  // '' = the patient's own condition (person.conditionRaw), exactly the
  // previous unconditional behavior — a coach can override it to browse a
  // DIFFERENT condition's recipes too (same filter AddRecipeModal's own
  // library browser already offers, just defaulted to "auto" here since
  // Replace always starts out scoped to THIS patient's own plan).
  const [condition, setCondition] = useState('');
  const [state, setState] = useState({ status: 'loading', items: [], excludedForAllergy: 0 });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', items: [], excludedForAllergy: 0 });
    const params = new URLSearchParams({
      mealType: mealType || '',
      dietType: dietType || person.vegPreference || '',
      language: person.language || '',
      conditionText: condition || person.conditionRaw || '',
      allergyText: person.foodAllergy || '',
      dislikeText: person.dislikeFood || '',
      excludeRecipeId: recipe.recipe_id || '',
    });
    apiFetch(`/api/recipe-alternatives?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Server returned ${r.status}`))))
      .then((data) => { if (!cancelled) setState({ status: 'ready', ...data }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', items: [], excludedForAllergy: 0, message: err.message }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe.recipe_id, mealType, dietType, condition]);

  return (
    <>
      <div className="diet-add-filters">
        <label className="modal-field">
          <span className="modal-label">Condition</span>
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">Patient's own condition (auto)</option>
            {Object.entries(CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {state.status === 'loading' && <p className="panel-status">Finding compatible recipes…</p>}
      {state.status === 'error' && <div className="error-banner">Could not load alternatives: {state.message}</div>}
      {state.status === 'ready' && (
        <>
          <p className="modal-hint">
            {state.items.length} compatible recipe{state.items.length === 1 ? '' : 's'} found
            {state.excludedForAllergy ? ` (${state.excludedForAllergy} hidden for ${person.foodAllergy} allergy)` : ''}.
            Unreviewed drafts are flagged — check them against the source before using with a patient.
          </p>
          {!state.items.length && (
            <p className="profile-empty-note">No compatible alternatives found in the library for this meal/diet/condition combination.</p>
          )}
          <div className="diet-recipe-grid">
            {state.items.map((alt) => (
              <AlternativeCard key={alt.recipe_id} recipe={alt} busy={selecting === alt.recipe_id} onSelect={onSelect} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function AiSuggestionTab({ recipe, mealType, dietType, person, onSelect, selecting }) {
  const [state, setState] = useState({ status: 'idle' }); // idle | loading | ready | error
  const [suggestion, setSuggestion] = useState(null);

  const requestSuggestion = () => {
    setState({ status: 'loading' });
    setSuggestion(null);
    apiFetch('/api/recipe-ai-suggestion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipe: { name: recipe.name, ingredients: recipe.ingredients, steps: recipe.steps },
        dietType: dietType || person.vegPreference,
        language: person.language,
        mealType,
        allergyText: person.foodAllergy,
        dislikeText: person.dislikeFood,
        // Sent as free text, same as /api/recipe-alternatives — the server
        // runs the same condition detector over it, so the two routes can
        // never disagree about what "the patient's condition" means.
        conditionText: person.conditionRaw,
      }),
    })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.error || `Server returned ${r.status}`)))))
      .then((data) => { setSuggestion(data); setState({ status: 'ready' }); })
      .catch((err) => setState({ status: 'error', message: err.message }));
  };

  return (
    <>
      <p className="modal-hint">
        Gemini generates one alternative, considering the patient's condition, diet type, language and allergies —
        always unreviewed until a dietitian checks it. Its photo (if any) is reused from the closest-matching
        library recipe, not AI-generated, so it's a real photo of a real dish.
      </p>

      {state.status === 'idle' && (
        <button type="button" className="modal-submit-btn" onClick={requestSuggestion}>✨ Get AI Suggestion</button>
      )}
      {state.status === 'loading' && <p className="panel-status">Asking Gemini…</p>}
      {state.status === 'error' && (
        <>
          <div className="error-banner">{state.message}</div>
          <button type="button" className="modal-submit-btn" onClick={requestSuggestion}>Try again</button>
        </>
      )}
      {state.status === 'ready' && suggestion && (
        <>
          <div className="diet-recipe-grid diet-recipe-grid-single">
            <AlternativeCard recipe={suggestion} busy={selecting === suggestion.recipe_id} onSelect={onSelect} actionLabel="Use this recipe" />
          </div>
          <button type="button" className="modal-cancel-btn diet-ai-retry-btn" onClick={requestSuggestion}>↻ Try another suggestion</button>
        </>
      )}
    </>
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.readAsDataURL(file);
  });
}

// mealType/dietType/language/conditionText tag this recipe for the SHARED
// library save below (server/lib/manualRecipeStore.js) — the same values
// already sent to /api/recipe-alternatives for this exact gear/patient, so a
// manually-typed recipe becomes findable there under the same filters from
// then on, for any other patient too.
export function ManualEntryTab({ onSelect, selecting, mealType, dietType, language, conditionText }) {
  const [name, setName] = useState('');
  const [ingredientsText, setIngredientsText] = useState('');
  const [stepsText, setStepsText] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleImageChange = (e) => {
    const file = e.target.files && e.target.files[0];
    setImageFile(file || null);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  };

  const ingredients = ingredientsText.split('\n').map((s) => s.trim()).filter(Boolean);
  const steps = stepsText.split('\n').map((s) => s.trim()).filter(Boolean);
  const canSubmit = name.trim() && ingredients.length && steps.length;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      let image;
      if (imageFile) {
        setUploading(true);
        const dataUrl = await fileToDataUrl(imageFile);
        const res = await apiFetch('/api/diet-image/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not upload image');
        image = data.image;
        setUploading(false);
      }
      // A dietitian is typing this by hand right now — there's no "unreviewed
      // machine draft" concern the way there is for a converted or
      // AI-generated recipe, so this counts as reviewed immediately.
      const recipeId = `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const newRecipe = { recipe_id: recipeId, name: name.trim(), ingredients, steps, image, reviewed: true };
      await onSelect(newRecipe);
      // Best-effort promotion into the shared cross-patient library, tagged
      // with the gear/condition this was entered under — never blocks or
      // surfaces an error here, since the recipe has already been applied to
      // THIS patient's plan by the point this runs (see server/lib/
      // manualRecipeStore.js).
      apiFetch('/api/manual-recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe: newRecipe, mealType, dietType, language, conditionText }),
      }).catch(() => {});
    } catch (err) {
      setUploading(false);
      setError(err.message || String(err));
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error-banner">{error}</div>}

      <label className="modal-field">
        <span className="modal-label">Recipe name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ridge Gourd Poriyal" autoFocus />
      </label>

      <label className="modal-field">
        <span className="modal-label">Ingredients</span>
        <textarea
          value={ingredientsText}
          onChange={(e) => setIngredientsText(e.target.value)}
          placeholder={'One per line, e.g.\nRidge gourd - 1 medium\nMustard seeds - 1/2 tsp\nSalt to taste'}
          rows={5}
        />
      </label>

      <label className="modal-field">
        <span className="modal-label">Preparation</span>
        <textarea
          value={stepsText}
          onChange={(e) => setStepsText(e.target.value)}
          placeholder={'One step per line, e.g.\nPeel and chop the ridge gourd.\nHeat oil, add mustard seeds.\nAdd the vegetable and cook covered for 8-10 minutes.'}
          rows={5}
        />
      </label>

      <label className="modal-field">
        <span className="modal-label">Photo (optional)</span>
        <input type="file" accept="image/jpeg,image/png,image/gif" onChange={handleImageChange} />
        {imagePreview && <img src={imagePreview} alt="" className="diet-manual-image-preview" />}
      </label>

      <button type="submit" className="modal-submit-btn" disabled={!canSubmit || uploading || selecting}>
        {uploading ? 'Uploading image…' : selecting ? 'Saving…' : 'Use this recipe'}
      </button>
    </form>
  );
}

const TABS = [
  { id: 'library', label: 'From Library' },
  { id: 'ai', label: '✨ AI Suggestion' },
  { id: 'manual', label: 'Enter Manually' },
];

function RecipeReplaceModal({ recipe, mealType, dietType, person, onSelect, onClose }) {
  const [tab, setTab] = useState('library');
  const [selecting, setSelecting] = useState(null);
  const [error, setError] = useState(null);

  const handleSelect = async (alternative) => {
    setSelecting(alternative.recipe_id);
    setError(null);
    try {
      await onSelect(alternative);
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
            <h2>Replace recipe</h2>
            <p className="modal-subtitle">Currently: {recipe.name}</p>
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
            <LibraryTab recipe={recipe} mealType={mealType} dietType={dietType} person={person} onSelect={handleSelect} selecting={selecting} />
          )}
          {tab === 'ai' && (
            <AiSuggestionTab recipe={recipe} mealType={mealType} dietType={dietType} person={person} onSelect={handleSelect} selecting={selecting} />
          )}
          {tab === 'manual' && (
            <ManualEntryTab
              onSelect={handleSelect}
              selecting={selecting}
              mealType={mealType}
              dietType={dietType}
              language={person.language}
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

export default RecipeReplaceModal;
