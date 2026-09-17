// [✏️ Edit] — opened from ANY recipe card in DietTemplateView (original,
// already-replaced, or coach-added — every card gets this button, unlike
// [Replace Recipe]/[Revert], which only apply to real slots). Lets a coach
// tweak a single line (name/one ingredient/one step) or swap just the photo,
// without having to pick a whole different dish from the library. Reuses the
// same name/ingredients-textarea/steps-textarea/photo-upload fields as
// RecipeReplaceModal's ManualEntryTab, just pre-filled with the CURRENT
// recipe's own content instead of starting blank, and always producing an
// edited-* id (see below) rather than reusing the original recipe_id — the
// content is no longer that library entry once hand-edited, and a fresh id
// keeps it out of any recipe_id-based matching (image dedup, eligibility
// search) meant for untouched library content.
import { useState } from 'react';
import { apiFetch } from '../lib/apiFetch';
import AuthedImage from './AuthedImage';

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.readAsDataURL(file);
  });
}

function EditRecipeModal({ recipe, onSave, onClose }) {
  const [name, setName] = useState(recipe.name || '');
  const [ingredientsText, setIngredientsText] = useState((recipe.ingredients || []).join('\n'));
  const [stepsText, setStepsText] = useState((recipe.steps || []).join('\n'));
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null); // only set once a NEW photo is chosen
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
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
      // Keeps the existing photo unless the coach picked a new one — there's
      // no "remove photo" control here, matching the scope of "change the
      // image", not "add or remove one".
      let image = recipe.image;
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
      // A coach is editing this by hand right now — same "no unreviewed
      // machine draft" reasoning as a manually-entered recipe.
      const recipeId = `edited-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await onSave({ recipe_id: recipeId, name: name.trim(), ingredients, steps, image, reviewed: true });
    } catch (err) {
      setUploading(false);
      setSaving(false);
      setError(err.message || String(err));
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <h2>Edit recipe</h2>
            <p className="modal-subtitle">Editing: {recipe.name}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}

          <label className="modal-field">
            <span className="modal-label">Recipe name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>

          <label className="modal-field">
            <span className="modal-label">Ingredients</span>
            <textarea
              value={ingredientsText}
              onChange={(e) => setIngredientsText(e.target.value)}
              placeholder="One per line"
              rows={6}
            />
          </label>

          <label className="modal-field">
            <span className="modal-label">Preparation</span>
            <textarea
              value={stepsText}
              onChange={(e) => setStepsText(e.target.value)}
              placeholder="One step per line"
              rows={6}
            />
          </label>

          <label className="modal-field">
            <span className="modal-label">Photo</span>
            {imagePreview ? (
              <img src={imagePreview} alt="" className="diet-manual-image-preview" />
            ) : recipe.image ? (
              <AuthedImage className="diet-manual-image-preview" src={recipe.image} alt="" />
            ) : null}
            <input type="file" accept="image/jpeg,image/png,image/gif" onChange={handleImageChange} />
          </label>
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-cancel-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="modal-submit-btn" disabled={!canSubmit || uploading || saving}>
            {uploading ? 'Uploading image…' : saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default EditRecipeModal;
