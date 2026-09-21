import { useState } from 'react';
import { STUDENT_FORM_STEPS, BLANK_STUDENT, isStepValid } from '../lib/studentFields';

// Used both to register a brand-new student (step-by-step, forward-only
// until a step is visited) and to edit an existing one (initial !== null —
// every step is freely clickable since the data's already there).
function RegisterStudentModal({ initial, onCancel, onSubmit }) {
  const isEdit = Boolean(initial);
  const [values, setValues] = useState(() => ({ ...BLANK_STUDENT, ...(initial || {}) }));
  const [stepIndex, setStepIndex] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const totalSteps = STUDENT_FORM_STEPS.length + 1; // + review
  const isReviewStep = stepIndex === STUDENT_FORM_STEPS.length;
  const step = STUDENT_FORM_STEPS[stepIndex];
  const canGoNext = step ? isStepValid(step, values) : true;

  const setField = (key, v) => setValues((prev) => ({ ...prev, [key]: v }));
  const goToStep = (i) => {
    if (isEdit || i <= maxVisited) setStepIndex(i);
  };
  const handleNext = () => {
    if (!canGoNext) return;
    const next = Math.min(stepIndex + 1, totalSteps - 1);
    setStepIndex(next);
    setMaxVisited((m) => Math.max(m, next));
  };
  const handleBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err.message || String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card modal-card-wide">
        <div className="modal-header">
          <div>
            <h2>{isEdit ? 'Edit Student' : 'Register Student'}</h2>
            <p className="modal-subtitle">
              {isEdit
                ? "Update this student's details — saved straight to the app's own student registry."
                : 'Step-by-step intake, asked one group of fields at a time — every detail the tracker sheet used to hold, entered right here.'}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        </div>

        <div className="wizard-steps">
          {STUDENT_FORM_STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              className={`wizard-step-item${i === stepIndex ? ' wizard-step-item-active' : ''}${i < maxVisited || isEdit ? ' wizard-step-item-done' : ''}`}
              onClick={() => goToStep(i)}
              disabled={!isEdit && i > maxVisited}
            >
              <span className="wizard-step-num">{i + 1}</span>
              <span className="wizard-step-label">{s.title}</span>
            </button>
          ))}
          <button
            type="button"
            className={`wizard-step-item${isReviewStep ? ' wizard-step-item-active' : ''}`}
            onClick={() => goToStep(STUDENT_FORM_STEPS.length)}
            disabled={!isEdit && maxVisited < STUDENT_FORM_STEPS.length - 1}
          >
            <span className="wizard-step-num">{STUDENT_FORM_STEPS.length + 1}</span>
            <span className="wizard-step-label">Review</span>
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}

          {!isReviewStep ? (
            <div className="modal-row">
              {step.fields.map((f) => (
                <label
                  key={f.key}
                  className="modal-field"
                  style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}
                >
                  <span className="modal-label">
                    {f.label} {f.required && <span className="modal-required">*</span>}
                  </span>
                  {f.type === 'select' ? (
                    <select value={values[f.key] || ''} onChange={(e) => setField(f.key, e.target.value)}>
                      {f.options.map((o) => (
                        <option key={o || 'blank'} value={o}>{o || '—'}</option>
                      ))}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea
                      rows={3}
                      value={values[f.key] || ''}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                    />
                  ) : (
                    <input
                      type="text"
                      value={values[f.key] || ''}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                    />
                  )}
                </label>
              ))}
            </div>
          ) : (
            <div className="wizard-review">
              {STUDENT_FORM_STEPS.map((s) => (
                <div key={s.title} className="wizard-review-group">
                  <h3>{s.title}</h3>
                  <div className="wizard-review-grid">
                    {s.fields.map((f) => (
                      <div key={f.key} className="wizard-review-row">
                        <span className="wizard-review-label">{f.label}</span>
                        <span className="wizard-review-value">{values[f.key] ? values[f.key] : <em>—</em>}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-cancel-btn" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          {stepIndex > 0 && (
            <button type="button" className="modal-cancel-btn" onClick={handleBack} disabled={submitting}>
              ← Back
            </button>
          )}
          {!isReviewStep ? (
            <button type="button" className="modal-submit-btn" onClick={handleNext} disabled={!canGoNext}>
              Next →
            </button>
          ) : (
            <button type="button" className="modal-submit-btn" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? '✓ Save Changes' : '✓ Register Student'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default RegisterStudentModal;
