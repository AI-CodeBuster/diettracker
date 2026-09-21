import { useCallback, useEffect, useMemo, useState } from 'react';
import RegisterStudentModal from './RegisterStudentModal';
import UploadStudentsModal from './UploadStudentsModal';
import StudentProfileModal from './StudentProfileModal';
import { apiFetch, openAuthedFile } from '../lib/apiFetch';
import { STUDENT_FIELD_LABELS } from '../lib/studentFields';

const TABLE_KEYS = ['studentId', 'name', 'contact', 'batch', 'hcName', 'vegPreference', 'language', 'age', 'gender'];

function matchesSearch(student, query) {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return [student.studentId, student.name, student.contact, student.batch, student.hcName]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}

// The app's own native student registry — register, view, edit, bulk-upload
// (CSV) and download student data without touching the external Tracker
// sheet at all. Deliberately a separate, self-contained page rather than
// folded into the sheet-driven Tracker screen, which stays untouched.
function StudentsPage({ isTL, isDeveloper }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const canDelete = isTL || isDeveloper;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch('/api/students', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setStudents(data.students || []);
      })
      .catch((err) => setError(String(err.message || err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => students.filter((s) => matchesSearch(s, query)), [students, query]);

  const handleRegister = async (values) => {
    const res = await apiFetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to register student');
    setStudents((list) => [data, ...list]);
    setShowRegister(false);
  };

  const handleUpdate = async (values) => {
    const res = await apiFetch(`/api/students/${editing.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save changes');
    setStudents((list) => list.map((s) => (s.id === data.id ? data : s)));
    setEditing(null);
  };

  const handleDelete = async (student) => {
    if (!window.confirm(`Remove ${student.name} from the app's student registry? This cannot be undone.`)) return;
    const prev = students;
    setStudents((list) => list.filter((s) => s.id !== student.id));
    try {
      const res = await apiFetch(`/api/students/${student.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete student');
      }
    } catch (err) {
      setStudents(prev);
      setError(String(err.message || err));
    }
  };

  const handleDownload = () => {
    openAuthedFile('/api/students/export.csv', 'students.csv').catch((err) => setError(String(err.message || err)));
  };

  return (
    <div className="issues-page students-page">
      <div className="issues-header">
        <div>
          <h1>Register Student</h1>
          <p className="issues-subtitle">
            The app's own student registry — register, edit, bulk-upload and download student data right here, no
            external sheet needed.
          </p>
        </div>
        <div className="students-header-actions">
          <button type="button" className="modal-cancel-btn" onClick={handleDownload} disabled={!students.length}>
            ⇩ Download
          </button>
          <button type="button" className="modal-cancel-btn" onClick={() => setShowUpload(true)}>
            ⇪ Upload Sheet
          </button>
          <button type="button" className="issues-raise-btn" onClick={() => setShowRegister(true)}>
            + Register Student
          </button>
        </div>
      </div>

      <div className="issues-controls">
        <div className="issues-search">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, Student ID, contact, batch or health coach"
          />
          {query && (
            <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              ×
            </button>
          )}
        </div>
        <span className="students-count">
          {filtered.length} of {students.length} student(s)
        </span>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && !students.length && <div className="loading-banner">Loading…</div>}
      {!loading && !filtered.length && !error && (
        <p className="empty-state">
          {students.length
            ? 'No students match that search.'
            : 'No students registered yet — click "+ Register Student" to add the first one.'}
        </p>
      )}

      {!!filtered.length && (
        <div className="generic-table-wrap">
          <table className="generic-table">
            <thead>
              <tr>
                {TABLE_KEYS.map((k) => (
                  <th key={k} className={k === TABLE_KEYS[0] ? 'generic-table-pin' : undefined}>
                    {STUDENT_FIELD_LABELS[k] || k}
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  {TABLE_KEYS.map((k) =>
                    k === 'name' ? (
                      <td key={k} className={k === TABLE_KEYS[0] ? 'generic-table-pin' : undefined}>
                        <button type="button" className="students-name-link" onClick={() => setViewing(s)}>
                          {s.name}
                        </button>
                      </td>
                    ) : (
                      <td key={k} className={k === TABLE_KEYS[0] ? 'generic-table-pin' : undefined}>
                        {s[k] || ''}
                      </td>
                    )
                  )}
                  <td className="students-row-actions">
                    <button type="button" className="students-edit-btn" onClick={() => setEditing(s)}>
                      Edit
                    </button>
                    {canDelete && (
                      <button type="button" className="students-delete-btn" onClick={() => handleDelete(s)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showRegister && <RegisterStudentModal onCancel={() => setShowRegister(false)} onSubmit={handleRegister} />}
      {editing && <RegisterStudentModal initial={editing} onCancel={() => setEditing(null)} onSubmit={handleUpdate} />}
      {showUpload && (
        <UploadStudentsModal
          onCancel={() => setShowUpload(false)}
          onImported={() => {
            load();
          }}
        />
      )}
      {viewing && !editing && (
        <div className="modal-overlay profile-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setViewing(null)}>
          <StudentProfileModal
            student={students.find((s) => s.id === viewing.id) || viewing}
            onClose={() => setViewing(null)}
            onEdit={(s) => {
              setViewing(null);
              setEditing(s);
            }}
          />
        </div>
      )}
    </div>
  );
}

export default StudentsPage;
