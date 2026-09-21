import { STUDENT_FORM_STEPS } from '../lib/studentFields';

// Read-only profile view for a student in the app's own registry — reuses
// the same .panel/.profile-* classes PatientProfile.jsx already uses for the
// sheet-based Tracker, so this looks like the same app rather than a bolted-
// on page, but stays a separate component since it has none of that
// component's sheet-derived gear-tracking/Mark-Prepared/TL-verify machinery
// (a freshly registered student has no sheet row for any of that to act on).
function StudentProfileModal({ student, onClose, onEdit }) {
  return (
    <div className="panel profile-panel">
      <header className="panel-header">
        <div>
          <h2>Profile</h2>
          <p className="panel-subtitle">
            {student.name}
            {student.studentId ? ` · #${student.studentId}` : ''}
          </p>
        </div>
        <div className="panel-header-actions">
          <button type="button" className="panel-fullscreen-btn" onClick={() => onEdit(student)}>
            ✏️ Edit
          </button>
          <button className="panel-close" onClick={onClose} type="button" aria-label="Close">
            ×
          </button>
        </div>
      </header>

      <div className="panel-body-wrap">
        <div className="panel-body profile-body">
          {STUDENT_FORM_STEPS.map((step) => (
            <section className="profile-section" key={step.title}>
              <h3>{step.title}</h3>
              <div className="profile-info-grid">
                {step.fields
                  .filter((f) => f.key !== 'name')
                  .map((f) => (
                    <div className="profile-info-item" key={f.key}>
                      <span className="profile-info-label">{f.label}</span>
                      <span className="profile-info-value">{student[f.key] || '—'}</span>
                    </div>
                  ))}
              </div>
            </section>
          ))}

          <section className="profile-section">
            <h3>Registration</h3>
            <div className="profile-info-grid">
              <div className="profile-info-item">
                <span className="profile-info-label">Registered by</span>
                <span className="profile-info-value">{student.createdByName || '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Registered on</span>
                <span className="profile-info-value">
                  {student.createdAt ? new Date(student.createdAt).toLocaleString() : '—'}
                </span>
              </div>
              {student.updatedByName && (
                <div className="profile-info-item">
                  <span className="profile-info-label">Last updated by</span>
                  <span className="profile-info-value">
                    {student.updatedByName}
                    {student.updatedAt ? ` · ${new Date(student.updatedAt).toLocaleString()}` : ''}
                  </span>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default StudentProfileModal;
