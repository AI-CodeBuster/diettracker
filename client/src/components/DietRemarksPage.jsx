// "Diet Remarks" — every TL-raised highlight+comment across every patient
// (see server/lib/dietRemarksStore.js), read-only here: raising one happens
// from inside the diet plan itself ([Highlight Mode] in DietTemplateView),
// resolving one happens there too (the coach is looking at the actual
// content they're fixing) — this page is the audit trail/queue view, not
// another place to act from.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/apiFetch';
import { patientKey } from '../lib/patientKey';

const QUICK_FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'everything', label: 'Everything' },
];

function matchesSearch(remark, query) {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return [
    remark.patientName, remark.healthCoachName, remark.batch, remark.conditionLabel,
    remark.highlightedText, remark.comment, remark.raisedByName,
  ]
    .filter(Boolean)
    .some((field) => field.toLowerCase().includes(q));
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function DietRemarksPage({ sheets, onJumpToRemark }) {
  const [remarks, setRemarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  // A remark row only ever carries a personKey snapshot (see
  // dietRemarksStore.js) — never which sheet that patient is actually on, so
  // "jump to their highlighted remark" has to search every person-sheet the
  // first time it's needed, same as Dashboard's own jump-to-person already
  // does. Cached once loaded (null = not loaded yet) since the same patient
  // list serves every subsequent click on this page.
  const [allPatients, setAllPatients] = useState(null);
  const [resolvingKey, setResolvingKey] = useState(null); // remark.id currently being resolved, for a per-row loading state
  const [jumpError, setJumpError] = useState(null);

  const loadRemarks = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch('/api/diet-remarks', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRemarks(data.remarks || []);
      })
      .catch((err) => setError(String(err.message || err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRemarks();
  }, [loadRemarks]);

  // Fetches every person-sheet's rows once, tagged with the sheet each came
  // from — mirrors Dashboard.jsx's own byPerson loader exactly (same
  // problem: knowing which sheet a patient is on requires having read every
  // sheet at least once). Cached in `allPatients` after the first call.
  const loadAllPatients = useCallback(async () => {
    if (allPatients) return allPatients;
    const results = await Promise.all((sheets || []).map((s) =>
      apiFetch(`/api/sheets/${encodeURIComponent(s.name)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((data) => (data.isPersonSheet ? data.rows.map((person) => ({ sheetName: s.name, person })) : []))
        .catch(() => []),
    ));
    const flat = results.flat();
    setAllPatients(flat);
    return flat;
  }, [sheets, allPatients]);

  const handleJumpToPatient = useCallback(async (remark) => {
    if (!onJumpToRemark) return;
    setJumpError(null);
    setResolvingKey(remark.id);
    try {
      const patients = await loadAllPatients();
      const match = patients.find(({ sheetName, person }) => patientKey(sheetName, person) === remark.personKey);
      if (!match) {
        setJumpError(`Couldn't find ${remark.patientName || 'this patient'} on any sheet — they may have been removed or renamed since this was raised.`);
        return;
      }
      onJumpToRemark({ sheetName: match.sheetName, personKey: remark.personKey, gear: remark.gear, remarkKey: remark.remarkKey });
    } finally {
      setResolvingKey(null);
    }
  }, [onJumpToRemark, loadAllPatients]);

  const counts = useMemo(() => {
    const c = { pending: 0, resolved: 0, everything: remarks.length };
    remarks.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [remarks]);

  const filtered = useMemo(() => remarks
    .filter((r) => (statusFilter === 'everything' ? true : r.status === statusFilter))
    .filter((r) => matchesSearch(r, query)), [remarks, statusFilter, query]);

  return (
    <div className="issues-page">
      <div className="issues-header">
        <div>
          <h1>Diet Remarks</h1>
          <p className="issues-subtitle">
            Every mistake a TL has highlighted inside a diet plan, and its comment. Raise one from a plan's own
            "Highlight Mode"; a coach resolves it there too, once fixed.
          </p>
        </div>
        <button type="button" className="issues-raise-btn" onClick={loadRemarks} disabled={loading}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      <div className="issues-controls">
        <div className="issues-search">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Patient, coach, batch, condition, comment…"
          />
          {query && (
            <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              ×
            </button>
          )}
        </div>
      </div>

      <div className="issues-pills">
        {QUICK_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`issues-pill${statusFilter === f.key ? ' issues-pill-active' : ''}`}
            onClick={() => setStatusFilter(f.key)}
          >
            {f.label} <span className="issues-pill-count">{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {jumpError && (
        <div className="error-banner diet-remarks-jump-error">
          {jumpError}
          <button type="button" onClick={() => setJumpError(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      {loading && !remarks.length && <div className="loading-banner">Loading…</div>}
      {!loading && !filtered.length && !error && (
        <p className="empty-state">Nothing here yet.</p>
      )}

      {!!filtered.length && (
        <div className="team-table-wrap">
          <table className="team-table diet-remarks-table">
            <thead>
              <tr>
                <th>Raised</th>
                <th>Patient</th>
                <th>Batch</th>
                <th>Gear</th>
                <th>Condition</th>
                <th>Health Coach</th>
                <th>Highlighted content</th>
                <th>Comment</th>
                <th>Raised by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.createdAt)}</td>
                  <td>
                    {r.patientName && onJumpToRemark ? (
                      <button
                        type="button"
                        className="diet-remarks-patient-link"
                        disabled={resolvingKey === r.id}
                        onClick={() => handleJumpToPatient(r)}
                        title="Open this patient's diet plan, scrolled to this highlight"
                      >
                        {resolvingKey === r.id ? 'Opening…' : r.patientName}
                      </button>
                    ) : (r.patientName || '—')}
                  </td>
                  <td>{r.batch || '—'}</td>
                  <td>Gear {r.gear}</td>
                  <td>{r.conditionLabel || '—'}</td>
                  <td>{r.healthCoachName || '—'}</td>
                  <td className="diet-remarks-table-snippet">{r.highlightedText}</td>
                  <td className="diet-remarks-table-snippet">{r.comment}</td>
                  <td>{r.raisedByName || '—'}</td>
                  <td>
                    {r.status === 'pending' ? (
                      <span className="diet-remarks-status-pending">Pending</span>
                    ) : (
                      <span className="diet-remarks-status-resolved" title={`Resolved by ${r.resolvedByName || 'someone'}`}>
                        Resolved · {formatDateTime(r.resolvedAt)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default DietRemarksPage;
