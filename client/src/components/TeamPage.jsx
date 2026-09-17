import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiFetch';

const ROLES = ['employee', 'tl', 'developer'];
const ROLE_LABELS = { employee: 'Employee', tl: 'TL', developer: 'Developer' };

function TeamPage() {
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const loadTeam = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch('/api/team', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setTeam(data.team || []);
      })
      .catch((err) => setError(String(err.message || err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  const handleRoleChange = async (member, role) => {
    const prev = team;
    setSavingId(member.id);
    setTeam((list) => list.map((m) => (m.id === member.id ? { ...m, role } : m)));
    try {
      const res = await apiFetch(`/api/team/${member.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update role');
    } catch (err) {
      setTeam(prev);
      setError(String(err.message || err));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="issues-page">
      <div className="issues-header">
        <div>
          <h1>Team</h1>
          <p className="issues-subtitle">
            Every account that has signed up, and their role. Grant "TL" here so someone can verify diet plans and
            leave remarks from inside the app — signup alone always starts as a plain Employee.
          </p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && !team.length && <div className="loading-banner">Loading…</div>}
      {!loading && !team.length && !error && <p className="empty-state">No accounts have signed up yet.</p>}

      {!!team.length && (
        <div className="team-table-wrap">
          <table className="team-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {team.map((member) => (
                <tr key={member.id}>
                  <td>{member.full_name || '—'}</td>
                  <td>{member.email}</td>
                  <td>
                    <select
                      value={member.role}
                      disabled={savingId === member.id}
                      onChange={(e) => handleRoleChange(member, e.target.value)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
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

export default TeamPage;
