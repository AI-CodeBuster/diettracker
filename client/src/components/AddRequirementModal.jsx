import { useState } from 'react';

function AddRequirementModal({ onCancel, onSubmit }) {
  const [priority, setPriority] = useState('medium');
  const [title, setTitle] = useState('');
  const [area, setArea] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ priority, title, area, description });
    } catch (err) {
      setError(err.message || String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <h2>Add a requirement</h2>
            <p className="modal-subtitle">A title is enough — the rest can be filled in later.</p>
          </div>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}

          <label className="modal-field">
            <span className="modal-label">How important?</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>

          <label className="modal-field">
            <span className="modal-label">
              Title <span className="modal-required">*</span>
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Bulk-export patient overrides to CSV"
              required
            />
          </label>

          <label className="modal-field">
            <span className="modal-label">Which area?</span>
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. Reporting, Lead Intake, Dietitian Tracker"
            />
            <span className="modal-hint">Which part of the CRM this is for</span>
          </label>

          <label className="modal-field">
            <span className="modal-label">What's needed, and why?</span>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you want built and the problem it solves."
            />
          </label>
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-cancel-btn" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="modal-submit-btn" disabled={submitting || !title.trim()}>
            {submitting ? 'Adding…' : '✓ Add requirement'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AddRequirementModal;
