import { useCallback, useEffect, useMemo, useState } from 'react';
import RequirementCard from './RequirementCard';
import AddRequirementModal from './AddRequirementModal';
import { apiFetch } from '../lib/apiFetch';
import { STATUS_ORDER, statusLabel } from '../lib/requirementLabels';

const QUICK_FILTERS = [
  { key: 'needs_review', label: 'Needs review', status: 'proposed' },
  { key: 'requested_by_me', label: 'Requested by me' },
  { key: 'in_progress', label: 'In Progress', status: 'in_progress' },
  { key: 'done', label: 'Done', status: 'done' },
  { key: 'declined', label: 'Declined', status: 'declined' },
  { key: 'everything', label: 'Everything' },
];

function matchesSearch(requirement, query) {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return [requirement.code, requirement.title, requirement.area, requirement.requestedByName, requirement.requestedByEmail]
    .filter(Boolean)
    .some((field) => field.toLowerCase().includes(q));
}

function RequirementsPage({ currentUserEmail, isDeveloper }) {
  const [requirements, setRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [statusQuickFilter, setStatusQuickFilter] = useState('needs_review');
  const [requestedByMe, setRequestedByMe] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [showAddModal, setShowAddModal] = useState(false);

  const loadRequirements = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch('/api/requirements', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRequirements(data.requirements || []);
      })
      .catch((err) => setError(String(err.message || err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRequirements();
  }, [loadRequirements]);

  const counts = useMemo(() => {
    const c = { needs_review: 0, requested_by_me: 0, everything: requirements.length };
    STATUS_ORDER.forEach((s) => {
      c[s] = 0;
    });
    requirements.forEach((r) => {
      c[r.status] = (c[r.status] || 0) + 1;
      if (r.status === 'proposed') c.needs_review += 1;
      if (r.requestedByEmail && r.requestedByEmail === currentUserEmail) c.requested_by_me += 1;
    });
    return c;
  }, [requirements, currentUserEmail]);

  const filteredRequirements = useMemo(() => {
    return requirements
      .filter((r) => (requestedByMe ? r.requestedByEmail === currentUserEmail : true))
      .filter((r) => {
        if (statusQuickFilter === 'everything') return true;
        const filter = QUICK_FILTERS.find((f) => f.key === statusQuickFilter);
        return filter ? r.status === filter.status : true;
      })
      .filter((r) => matchesSearch(r, query));
  }, [requirements, requestedByMe, statusQuickFilter, query, currentUserEmail]);

  const handleQuickFilter = (key) => {
    if (key === 'requested_by_me') {
      setRequestedByMe((v) => !v);
      return;
    }
    setStatusQuickFilter(key);
  };

  const handleStatusChange = async (requirement, status) => {
    const prev = requirements;
    setRequirements((list) => list.map((r) => (r.id === requirement.id ? { ...r, status } : r)));
    try {
      const res = await apiFetch(`/api/requirements/${requirement.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update status');
    } catch (err) {
      setRequirements(prev);
      setError(String(err.message || err));
    }
  };

  const handleAdd = async (payload) => {
    const res = await apiFetch('/api/requirements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add requirement');
    setRequirements((list) => [data, ...list]);
    setShowAddModal(false);
  };

  return (
    <div className="issues-page">
      <div className="issues-header">
        <div>
          <h1>Requirements</h1>
          <p className="issues-subtitle">Features and improvements the CRM still needs. Add one here so it's tracked instead of forgotten.</p>
        </div>
        <button type="button" className="issues-raise-btn" onClick={() => setShowAddModal(true)}>
          + Add requirement
        </button>
      </div>

      <div className="issues-controls">
        <div className="issues-search">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ID, title, area or who requested it"
          />
          {query && (
            <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              ×
            </button>
          )}
        </div>

        <label className="issues-select-field">
          <span>Requested by</span>
          <select value={requestedByMe ? 'me' : 'everyone'} onChange={(e) => setRequestedByMe(e.target.value === 'me')}>
            <option value="everyone">Everyone</option>
            <option value="me">Me</option>
          </select>
        </label>

        <div className="issues-view-toggle">
          <button type="button" className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>
            ≡ List
          </button>
          <button type="button" className={viewMode === 'board' ? 'active' : ''} onClick={() => setViewMode('board')}>
            ⊞ Board
          </button>
        </div>
      </div>

      <div className="issues-pills">
        {QUICK_FILTERS.map((f) => {
          const active = f.key === 'requested_by_me' ? requestedByMe : statusQuickFilter === f.key;
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
      {loading && !requirements.length && <div className="loading-banner">Loading…</div>}

      {!loading && !filteredRequirements.length && !error && <p className="empty-state">Nothing here yet.</p>}

      {viewMode === 'list' ? (
        <div className="issues-list">
          {filteredRequirements.map((requirement) => (
            <RequirementCard key={requirement.id} requirement={requirement} onStatusChange={handleStatusChange} canManage={isDeveloper} />
          ))}
        </div>
      ) : (
        <div className="issues-board">
          {STATUS_ORDER.map((status) => (
            <div key={status} className="issues-board-column">
              <div className="issues-board-column-header">
                {statusLabel(status)}
                <span className="issues-pill-count">{filteredRequirements.filter((r) => r.status === status).length}</span>
              </div>
              <div className="issues-board-column-body">
                {filteredRequirements
                  .filter((r) => r.status === status)
                  .map((requirement) => (
                    <RequirementCard key={requirement.id} requirement={requirement} onStatusChange={handleStatusChange} canManage={isDeveloper} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && <AddRequirementModal onCancel={() => setShowAddModal(false)} onSubmit={handleAdd} />}
    </div>
  );
}

export default RequirementsPage;
