import { useState } from 'react';

const REPRO_PLACEHOLDER = '1. Open Onboarding Calls\n2. Click any lead\n3. The form is blank';

function RaiseIssueModal({ onCancel, onSubmit }) {
  const [kind, setKind] = useState('bug');
  const [urgency, setUrgency] = useState('medium');
  const [title, setTitle] = useState('');
  const [screen, setScreen] = useState('');
  const [whatHappened, setWhatHappened] = useState('');
  const [reproSteps, setReproSteps] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ kind, urgency, title, screen, whatHappened, reproSteps });
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
            <h2>Raise a bug or enhancement</h2>
            <p className="modal-subtitle">A title and a screenshot is enough — the rest can be filled in later.</p>
          </div>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}

          <div className="modal-row">
            <label className="modal-field">
              <span className="modal-label">What is it?</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="bug">Bug — something is broken</option>
                <option value="enhancement">Enhancement — something to improve</option>
              </select>
            </label>
            <label className="modal-field">
              <span className="modal-label">How urgent?</span>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
          </div>

          <label className="modal-field">
            <span className="modal-label">
              Title <span className="modal-required">*</span>
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Call form goes blank when I click a lead"
              required
            />
          </label>

          <label className="modal-field">
            <span className="modal-label">Which screen?</span>
            <input
              type="text"
              value={screen}
              onChange={(e) => setScreen(e.target.value)}
              placeholder="e.g. Onboarding Calls, TagMango, Accounts"
            />
            <span className="modal-hint">Where you were when it happened — the name you'd say out loud is fine</span>
          </label>

          <label className="modal-field">
            <span className="modal-label">What happened?</span>
            <textarea
              rows={3}
              value={whatHappened}
              onChange={(e) => setWhatHappened(e.target.value)}
              placeholder="What you expected, and what you got instead."
            />
          </label>

          <label className="modal-field">
            <span className="modal-label">How do we make it happen again?</span>
            <textarea
              rows={4}
              value={reproSteps}
              onChange={(e) => setReproSteps(e.target.value)}
              placeholder={REPRO_PLACEHOLDER}
            />
          </label>
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-cancel-btn" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="modal-submit-btn" disabled={submitting || !title.trim()}>
            {submitting ? 'Raising…' : '✓ Raise it'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default RaiseIssueModal;
