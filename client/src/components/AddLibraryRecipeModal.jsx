// The Library's own [+ Add recipe] (client/src/components/LibraryPage.jsx),
// distinct from AddRecipeModal/RecipeReplaceModal's "Enter Manually" tab:
// those add a recipe to ONE patient's plan and best-effort promote it into
// the shared library, tagged from whatever gear/meal/patient was already on
// screen. There's no patient context here — this page asks for the
// Library's own tags directly (condition(s), gear(s), categories, language),
// exactly as requested, before it can be saved and filtered on later.
import { useState } from 'react';
import { apiFetch } from '../lib/apiFetch';
import { CONDITION_LABELS, LANGUAGE_LABELS, LIBRARY_CATEGORY_OPTIONS, LIBRARY_GEAR_OPTIONS } from '../lib/labels';

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.readAsDataURL(file);
  });
}

function ToggleGroup({ label, options, selected, onToggle, renderOption }) {
  return (
    <div className="modal-field">
      <span className="modal-label">{label}</span>
      <div className="library-toggle-group">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              className={`issues-pill library-toggle-pill${active ? ' issues-pill-active' : ''}`}
              onClick={() => onToggle(opt)}
            >
              {renderOption ? renderOption(opt) : opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AddLibraryRecipeModal({ onAdded, onClose }) {
  const [name, setName] = useState('');
  const [ingredientsText, setIngredientsText] = useState('');
  const [stepsText, setStepsText] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [conditions, setConditions] = useState([]);
  const [gear, setGear] = useState([]);
  const [categories, setCategories] = useState([]);
  const [language, setLanguage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (setFn) => (value) => setFn((list) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]));

  const handleImageChange = (e) => {
    const file = e.target.files && e.target.files[0];
    setImageFile(file || null);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  };

  const ingredients = ingredientsText.split('\n').map((s) => s.trim()).filter(Boolean);
  const steps = stepsText.split('\n').map((s) => s.trim()).filter(Boolean);
  const canSubmit = name.trim() && ingredients.length && steps.length
    && conditions.length && gear.length && categories.length && language;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit || saving) return;
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
      setSaving(true);
      const res = await apiFetch('/api/recipe-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipe: { name: name.trim(), ingredients, steps, image },
          conditions,
          gear,
          categories,
          language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save recipe');
      onAdded(data);
    } catch (err) {
      setUploading(false);
      setSaving(false);
      setError(err.message || String(err));
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card diet-replace-modal">
        <div className="modal-header">
          <div>
            <h2>Add a recipe to the Library</h2>
            <p className="modal-subtitle">Available to every patient's plan afterward, tagged by these filters.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
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
                rows={4}
              />
            </label>

            <label className="modal-field">
              <span className="modal-label">Preparation</span>
              <textarea
                value={stepsText}
                onChange={(e) => setStepsText(e.target.value)}
                placeholder={'One step per line, e.g.\nPeel and chop the ridge gourd.\nHeat oil, add mustard seeds.\nAdd the vegetable and cook covered for 8-10 minutes.'}
                rows={4}
              />
            </label>

            <label className="modal-field">
              <span className="modal-label">Photo (optional)</span>
              <input type="file" accept="image/jpeg,image/png,image/gif" onChange={handleImageChange} />
              {imagePreview && <img src={imagePreview} alt="" className="diet-manual-image-preview" />}
            </label>

            <ToggleGroup
              label="Condition (select all that apply)"
              options={Object.keys(CONDITION_LABELS)}
              selected={conditions}
              onToggle={toggle(setConditions)}
              renderOption={(c) => CONDITION_LABELS[c]}
            />

            <ToggleGroup
              label="Gear (select all that apply)"
              options={LIBRARY_GEAR_OPTIONS}
              selected={gear}
              onToggle={toggle(setGear)}
              renderOption={(g) => `Gear ${g}`}
            />

            <ToggleGroup
              label="Category (select all that apply)"
              options={LIBRARY_CATEGORY_OPTIONS}
              selected={categories}
              onToggle={toggle(setCategories)}
            />

            <ToggleGroup
              label="Language"
              options={Object.keys(LANGUAGE_LABELS)}
              selected={language ? [language] : []}
              onToggle={(value) => setLanguage((v) => (v === value ? '' : value))}
              renderOption={(l) => LANGUAGE_LABELS[l]}
            />

            <button type="submit" className="modal-submit-btn" disabled={!canSubmit || uploading || saving}>
              {uploading ? 'Uploading image…' : saving ? 'Saving…' : 'Add to Library'}
            </button>
          </form>
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-cancel-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default AddLibraryRecipeModal;
