import { useCallback, useEffect, useMemo, useState } from 'react';
import IssueCard from './IssueCard';
import RaiseIssueModal from './RaiseIssueModal';
import { apiFetch } from '../lib/apiFetch';
import { STATUS_ORDER, statusLabel } from '../lib/issueLabels';

const QUICK_FILTERS = [
  { key: 'needs_work', label: 'Needs work' },
  { key: 'raised_by_me', label: 'Raised by me' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'fixed', label: 'Fixed' },
  { key: 'wont_do', label: "Won't Do" },
  { key: 'everything', label: 'Everything' },
];

function matchesSearch(issue, query) {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return [issue.code, issue.title, issue.screen, issue.raisedByName, issue.raisedByEmail]
    .filter(Boolean)
    .some((field) => field.toLowerCase().includes(q));
}

function IssuesPage({ currentUserEmail, isDeveloper }) {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [statusQuickFilter, setStatusQuickFilter] = useState('needs_work');
  const [raisedByMe, setRaisedByMe] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [showRaiseModal, setShowRaiseModal] = useState(false);

  const loadIssues = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch('/api/issues', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setIssues(data.issues || []);
      })
      .catch((err) => setError(String(err.message || err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadIssues();
  }, [loadIssues]);

  const kindScoped = useMemo(
    () => (kindFilter === 'all' ? issues : issues.filter((i) => i.kind === kindFilter)),
    [issues, kindFilter]
  );

  const counts = useMemo(() => {
    const c = { needs_work: 0, raised_by_me: 0, everything: kindScoped.length };
    STATUS_ORDER.forEach((s) => {
      c[s] = 0;
    });
    kindScoped.forEach((issue) => {
      c[issue.status] = (c[issue.status] || 0) + 1;
      if (issue.status === 'open' || issue.status === 'in_progress') c.needs_work += 1;
      if (issue.raisedByEmail && issue.raisedByEmail === currentUserEmail) c.raised_by_me += 1;
    });
    return c;
  }, [kindScoped, currentUserEmail]);

  const filteredIssues = useMemo(() => {
    return kindScoped
      .filter((issue) => (raisedByMe ? issue.raisedByEmail === currentUserEmail : true))
      .filter((issue) => {
        if (statusQuickFilter === 'everything') return true;
        if (statusQuickFilter === 'needs_work') return issue.status === 'open' || issue.status === 'in_progress';
        return issue.status === statusQuickFilter;
      })
      .filter((issue) => matchesSearch(issue, query));
  }, [kindScoped, raisedByMe, statusQuickFilter, query, currentUserEmail]);

  const handleQuickFilter = (key) => {
    if (key === 'raised_by_me') {
      setRaisedByMe((v) => !v);
      return;
    }
    setStatusQuickFilter(key);
  };

  const handleStatusChange = async (issue, status) => {
    const prev = issues;
    setIssues((list) => list.map((i) => (i.id === issue.id ? { ...i, status } : i)));
    try {
      const res = await apiFetch(`/api/issues/${issue.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update status');
    } catch (err) {
      setIssues(prev);
      setError(String(err.message || err));
    }
  };

  const handleRaise = async (payload) => {
    const res = await apiFetch('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to raise issue');
    setIssues((list) => [data, ...list]);
    setShowRaiseModal(false);
  };

  return (
    <div className="issues-page">
      <div className="issues-header">
        <div>
          <h1>Bugs & Enhancements</h1>
          <p className="issues-subtitle">Anything broken, missing or worth improving in the CRM. Raise it here and it stops being a message nobody can find.</p>
        </div>
        <button type="button" className="issues-raise-btn" onClick={() => setShowRaiseModal(true)}>
          + Raise
        </button>
      </div>

      <div className="issues-controls">
        <div className="issues-search">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ID, title, screen or who raised it"
          />
          {query && (
            <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              ×
            </button>
          )}
        </div>

        <label className="issues-select-field">
          <span>Kind</span>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="all">Bugs and enhancements</option>
            <option value="bug">Bugs only</option>
            <option value="enhancement">Enhancements only</option>
          </select>
        </label>

        <label className="issues-select-field">
          <span>Raised by</span>
          <select value={raisedByMe ? 'me' : 'everyone'} onChange={(e) => setRaisedByMe(e.target.value === 'me')}>
            <option value="everyone">Everyone</option>
            <option value="me">Me</option>
          </select>
        </label>

        <div className="issues-view-toggle">
          <button
            type="button"
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
          >
            ≡ List
          </button>
          <button
            type="button"
            className={viewMode === 'board' ? 'active' : ''}
            onClick={() => setViewMode('board')}
          >
            ⊞ Board
          </button>
        </div>
      </div>

      <div className="issues-pills">
        {QUICK_FILTERS.map((f) => {
          const active = f.key === 'raised_by_me' ? raisedByMe : statusQuickFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              className={`issues-pill${active ? ' issues-pill-active' : ''}`}
              onClick={() => handleQuickFilter(f.key)}
            >
              {f.label} <span className="issues-pill-count">{counts[f.key] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && !issues.length && <div className="loading-banner">Loading…</div>}

      {!loading && !filteredIssues.length && !error && (
        <p className="empty-state">Nothing here yet.</p>
      )}

      {viewMode === 'list' ? (
        <div className="issues-list">
          {filteredIssues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} onStatusChange={handleStatusChange} canManage={isDeveloper} />
          ))}
        </div>
      ) : (
        <div className="issues-board">
          {STATUS_ORDER.map((status) => (
            <div key={status} className="issues-board-column">
              <div className="issues-board-column-header">
                {statusLabel(status)}
                <span className="issues-pill-count">{filteredIssues.filter((i) => i.status === status).length}</span>
              </div>
              <div className="issues-board-column-body">
                {filteredIssues
                  .filter((i) => i.status === status)
                  .map((issue) => (
                    <IssueCard key={issue.id} issue={issue} onStatusChange={handleStatusChange} canManage={isDeveloper} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showRaiseModal && <RaiseIssueModal onCancel={() => setShowRaiseModal(false)} onSubmit={handleRaise} />}
    </div>
  );
}

export default IssuesPage;
