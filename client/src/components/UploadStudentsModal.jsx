import { useState } from 'react';
import { apiFetch } from '../lib/apiFetch';

function UploadStudentsModal({ onCancel, onImported }) {
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.onerror = () => setError('Could not read that file');
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!csvText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/students/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setResult(data);
      onImported();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <h2>Upload Sheet</h2>
            <p className="modal-subtitle">
              Bulk-add or update students from a CSV file. Save your spreadsheet as CSV first (or use the
              "Download" button on the Register Student page to get a starting template in the app's own format).
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}

          <label className="modal-field">
            <span className="modal-label">CSV file</span>
            <input type="file" accept=".csv,text/csv" onChange={handleFile} />
            <span className="modal-hint">
              {fileName
                ? `Selected: ${fileName}`
                : 'The first row must be column headers. Student Name is required — every other column is matched by name and safe to leave out.'}
            </span>
          </label>

          {result && (
            <div className="upload-result">
              <p>
                <strong>{result.imported}</strong> of {result.totalRows} row(s) imported — rows whose Student ID
                already existed were updated, everything else was added new.
              </p>
              {result.skipped?.length > 0 && (
                <p className="upload-result-warn">
                  {result.skipped.length} row(s) skipped for missing a student name (row {result.skipped.map((s) => s.row).join(', ')}).
                </p>
              )}
              {result.unmatchedHeaders?.length > 0 && (
                <p className="upload-result-warn">
                  Column(s) not recognized, ignored: {result.unmatchedHeaders.join(', ')}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-cancel-btn" onClick={onCancel}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button type="button" className="modal-submit-btn" onClick={handleImport} disabled={!csvText.trim() || busy}>
              {busy ? 'Importing…' : '⇪ Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default UploadStudentsModal;
