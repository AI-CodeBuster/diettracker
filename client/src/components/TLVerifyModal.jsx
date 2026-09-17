import { useState } from 'react';

// Matches the sheet's own data-validation dropdowns exactly (see the
// tracker's "Template" tab) — server/lib/tlVerificationWriter.js validates
// against the same two lists.
const ACCURACY_OPTIONS = ['NA', 'Yes', 'No'];
const QUALITY_OPTIONS = [
  'NA',
  'Yes',
  'Clarity and readability error',
  'grammar/ spelling/wording error',
  'format error',
  'visual / image error',
  'overall professionalism error',
  'overall alignment error',
];

function TLVerifyModal({ person, gear, onCancel, onSubmit }) {
  const [verified, setVerified] = useState(!!(person.gearTLVerified && person.gearTLVerified[gear]));
  const [dietAccuracy, setDietAccuracy] = useState((person.gearDietAccuracy && person.gearDietAccuracy[gear]) || 'NA');
  const [dietQuality, setDietQuality] = useState((person.gearDietQuality && person.gearDietQuality[gear]) || 'NA');
  const [remarks, setRemarks] = useState((person.gearTLRemarks && person.gearTLRemarks[gear]) || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ verified, dietAccuracy, dietQuality, remarks });
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
            <h2>TL verification — Gear {gear}</h2>
            <p className="modal-subtitle">
              {person.name}
              {person.studentId ? ` · #${person.studentId}` : ''}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}

          <label className="modal-field modal-field-checkbox">
            <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
            <span className="modal-label">Mark this gear as Verified</span>
          </label>

          <label className="modal-field">
            <span className="modal-label">Diet Accuracy</span>
            <select value={dietAccuracy} onChange={(e) => setDietAccuracy(e.target.value)}>
              {ACCURACY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>

          <label className="modal-field">
            <span className="modal-label">Diet Quality</span>
            <select value={dietQuality} onChange={(e) => setDietQuality(e.target.value)}>
              {QUALITY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>

          <label className="modal-field">
            <span className="modal-label">TL Remarks</span>
            <textarea
              rows={4}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Notes for the coach — changes needed, or why this was approved as-is."
            />
          </label>
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-cancel-btn" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="modal-submit-btn" disabled={submitting}>
            {submitting ? 'Saving…' : '✓ Save to sheet'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default TLVerifyModal;
