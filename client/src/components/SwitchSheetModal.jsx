import { useState } from 'react';
import { apiFetch } from '../lib/apiFetch';

function SwitchSheetModal({ onCancel, onSwitch }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [discovered, setDiscovered] = useState(null); // { spreadsheetId, title, sheets }

  const handleLoadTabs = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    setDiscovered(null);
    try {
      const res = await apiFetch(`/api/spreadsheet-tabs?spreadsheetId=${encodeURIComponent(input.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not read that spreadsheet');
      if (!data.sheets.length) throw new Error('That spreadsheet has no tabs');
      setDiscovered(data);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSwitch = () => {
    onSwitch({ id: discovered.spreadsheetId, title: discovered.title, sheets: discovered.sheets });
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal-card" onSubmit={handleLoadTabs}>
        <div className="modal-header">
          <div>
            <h2>Switch sheet</h2>
            <p className="modal-subtitle">Paste a Google Sheets link and this view — just yours, no one else's — will read from it instead.</p>
          </div>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}

          <label className="modal-field">
            <span className="modal-label">Spreadsheet link</span>
            <input
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setDiscovered(null); }}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              autoFocus
            />
            <span className="modal-hint">Must be shared as "Anyone with the link can view".</span>
          </label>

          {!discovered && (
            <button type="submit" className="modal-submit-btn" disabled={loading || !input.trim()}>
              {loading ? 'Reading…' : 'Load tabs'}
            </button>
          )}

          {discovered && (
            <div className="switch-sheet-found">
              <p className="switch-sheet-found-title">{discovered.title}</p>
              <p className="switch-sheet-found-meta">{discovered.sheets.length} tab{discovered.sheets.length === 1 ? '' : 's'} found:</p>
              <div className="switch-sheet-tab-list">
                {discovered.sheets.map((s) => (
                  <span key={s.name} className="tag tag-muted">{s.label}</span>
                ))}
              </div>
              <p className="modal-hint">
                Status marking and weight trends stay off while viewing this sheet, to keep them from ever mixing with the real tracker's data.
              </p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-cancel-btn" onClick={onCancel}>
            Cancel
          </button>
          {discovered && (
            <button type="button" className="modal-submit-btn" onClick={handleSwitch}>
              ✓ Switch to this spreadsheet
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export default SwitchSheetModal;
