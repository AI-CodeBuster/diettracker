// Tracker overview: per-gear/per-status counts with a per-student
// drill-down list, plus a due-date reminders section — the "Dashboard" half
// of the stakeholder's "Dashboard or Notification Bell" ask, covering both
// the overall tracker-progress view and the individual pending-diet list.
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/apiFetch';
import { patientKey } from '../lib/patientKey';
import { daysLeft } from '../lib/dates';
import { deriveGearStatus, indexStatuses } from '../lib/gearStatus';
import { STATUS_ORDER, statusLabel, statusClass } from '../lib/gearStatusLabels';
import { mailReminder } from '../lib/mailSchedule';
import { computeTeamPerformance } from '../lib/teamPerformance';

const GEARS = [2, 3, 4];

// Every other per-person store in this app (overrides, status, weight log)
// already treats patientKey as the one stable identity for a person
// regardless of which sheet tab a request came from — see patientKey.js. If
// a Student ID ever appears on more than one tab, this dashboard should
// honor that same invariant rather than double-count the row and let a
// click resolve to whichever copy happens to load last. Prefers the row
// with more populated columns when there's a duplicate to choose between.
function richness(person) {
  return Object.keys(person.raw || {}).length;
}

function dedupePeople(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    const key = patientKey(entry.sheetName, entry.person);
    const existing = map.get(key);
    if (!existing || richness(entry.person) > richness(existing.person)) map.set(key, entry);
  });
  return [...map.values()];
}

function useAllPeople(sheets, spreadsheetId) {
  const [byPerson, setByPerson] = useState([]); // [{ sheetName, person }]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sheets.length) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = spreadsheetId ? `?spreadsheetId=${encodeURIComponent(spreadsheetId)}` : '';
    Promise.all(
      sheets.map((s) =>
        apiFetch(`/api/sheets/${encodeURIComponent(s.name)}${qs}`)
          .then((r) => r.json())
          .then((data) => (data.isPersonSheet ? data.rows.map((person) => ({ sheetName: s.name, person })) : []))
          .catch(() => [])
      )
    )
      .then((lists) => { if (!cancelled) setByPerson(dedupePeople(lists.flat())); })
      .catch((err) => { if (!cancelled) setError(String(err.message || err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sheets, spreadsheetId]);

  return { byPerson, loading, error };
}

function Dashboard({ sheets, onJumpToPerson, externalSpreadsheet }) {
  const { byPerson, loading, error } = useAllPeople(sheets, externalSpreadsheet?.id);
  const [statuses, setStatuses] = useState([]);
  const [expanded, setExpanded] = useState(null); // `${gear}:${status}` | null

  useEffect(() => {
    // Data-integrity boundary (see the Switch Sheet plan / lib/externalSpreadsheet.js):
    // an external spreadsheet's rows never touch the patientKey-scoped
    // status table, so there's nothing meaningful to fetch here for it —
    // tiles will show Pending/Prepared/Verified only, derived from the
    // sheet itself.
    if (externalSpreadsheet) { setStatuses([]); return; }
    apiFetch('/api/patient-status')
      .then((r) => r.json())
      .then((data) => setStatuses(data.statuses || []))
      .catch(() => {});
  }, [externalSpreadsheet]);

  const statusMap = useMemo(() => indexStatuses(statuses), [statuses]);

  const [effortSummary, setEffortSummary] = useState(null); // { targets, counts }
  const [preparedAtMap, setPreparedAtMap] = useState({});

  useEffect(() => {
    // Effort Goal / Prep-Verification % are program-wide constants, not
    // per-spreadsheet — same for the default tracker or a "Switch sheet" one.
    // Both endpoints 500 until diet_effort_log exists in Supabase (see
    // supabase/schema.sql) — that's expected until it's been run, so this
    // just leaves effortSummary/preparedAtMap at their empty defaults rather
    // than surfacing an error banner for it.
    apiFetch('/api/effort-summary')
      .then((r) => r.json())
      .then((d) => { if (!d.error) setEffortSummary(d); })
      .catch(() => {});
    apiFetch('/api/effort-log/prepared-times')
      .then((r) => r.json())
      .then((d) => { if (!d.error) setPreparedAtMap(d.preparedAt || {}); })
      .catch(() => {});
  }, []);

  const teamPerformance = useMemo(() => computeTeamPerformance(byPerson, preparedAtMap), [byPerson, preparedAtMap]);

  const mailReminders = useMemo(() => {
    const list = [];
    byPerson.forEach(({ sheetName, person }) => {
      const key = patientKey(sheetName, person);
      GEARS.forEach((gear) => {
        const reminder = mailReminder(person, gear);
        if (reminder) list.push({ sheetName, person, key, gear, ...reminder });
      });
    });
    return list;
  }, [byPerson]);

  const tiles = useMemo(() => {
    const t = {};
    GEARS.forEach((gear) => {
      t[gear] = {};
      STATUS_ORDER.forEach((s) => { t[gear][s] = []; });
    });
    byPerson.forEach(({ sheetName, person }) => {
      const key = patientKey(sheetName, person);
      GEARS.forEach((gear) => {
        const row = statusMap.get(`${key}:${gear}`);
        const status = deriveGearStatus(person, gear, row && row.status);
        t[gear][status].push({ sheetName, person, key });
      });
    });
    return t;
  }, [byPerson, statusMap]);

  const reminders = useMemo(() => {
    const overdue = [];
    const upcoming = [];
    byPerson.forEach(({ sheetName, person }) => {
      const key = patientKey(sheetName, person);
      GEARS.forEach((gear) => {
        const row = statusMap.get(`${key}:${gear}`);
        const status = deriveGearStatus(person, gear, row && row.status);
        if (status === 'completed') return;
        const due = daysLeft(person.gearDates && person.gearDates[gear]);
        if (!due || due.status === 'done') return;
        const entry = { sheetName, person, key, gear, days: due.days };
        if (due.status === 'overdue') overdue.push(entry);
        else if (due.days <= 7) upcoming.push(entry);
      });
    });
    overdue.sort((a, b) => b.days - a.days);
    upcoming.sort((a, b) => a.days - b.days);
    return { overdue, upcoming };
  }, [byPerson, statusMap]);

  const jump = (sheetName, key) => onJumpToPerson && onJumpToPerson({ sheetName, personKey: key });

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <p className="issues-subtitle">
          {externalSpreadsheet
            ? `A live rollup of "${externalSpreadsheet.title}" — Call Done/Completed and weight trends aren't tracked for external sheets.`
            : "A live rollup of every student's diet-prep progress across all sheets."}
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="loading-banner">Loading…</div>}

      {!loading && (
        <>
          <section className="dashboard-section">
            <h2>By status</h2>
            <div className="dashboard-tile-grid">
              {GEARS.map((gear) =>
                STATUS_ORDER.map((status) => {
                  const list = tiles[gear][status];
                  const key = `${gear}:${status}`;
                  const isOpen = expanded === key;
                  return (
                    <div key={key} className={`dashboard-tile ${statusClass(status)}${isOpen ? ' dashboard-tile-open' : ''}`}>
                      <button
                        type="button"
                        className="dashboard-tile-head"
                        onClick={() => setExpanded(isOpen ? null : key)}
                        disabled={!list.length}
                      >
                        <span className="dashboard-tile-count">{list.length}</span>
                        <span className="dashboard-tile-label">Gear {gear} · {statusLabel(status)}</span>
                      </button>
                      {isOpen && (
                        <ul className="dashboard-tile-list">
                          {list.map(({ sheetName, person, key: pKey }) => (
                            <li key={pKey}>
                              <button type="button" onClick={() => jump(sheetName, pKey)}>
                                {person.name}{person.hcName ? ` · ${person.hcName}` : ''}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="dashboard-section">
            <h2>Reminders</h2>
            {!reminders.overdue.length && !reminders.upcoming.length && (
              <p className="profile-empty-note">Nothing overdue or due soon.</p>
            )}
            {!!reminders.overdue.length && (
              <div className="dashboard-reminder-group">
                <h3 className="dashboard-reminder-heading dashboard-reminder-heading-overdue">Overdue</h3>
                <ul className="dashboard-reminder-list">
                  {reminders.overdue.map((r) => (
                    <li key={`${r.key}-${r.gear}`}>
                      <button type="button" onClick={() => jump(r.sheetName, r.key)}>
                        {r.person.name} — Gear {r.gear} overdue {r.days}d
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!reminders.upcoming.length && (
              <div className="dashboard-reminder-group">
                <h3 className="dashboard-reminder-heading">Due soon</h3>
                <ul className="dashboard-reminder-list">
                  {reminders.upcoming.map((r) => (
                    <li key={`${r.key}-${r.gear}`}>
                      <button type="button" onClick={() => jump(r.sheetName, r.key)}>
                        {r.person.name} — Gear {r.gear} due in {r.days}d
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="dashboard-section">
            <h2>Mail schedule</h2>
            <p className="issues-subtitle">
              1st mail when a gear's prep window ends without it being prepared yet; 2nd (escalation) mail once it's
              prepared but still pending TL verification — based on each student's own Current Day.
            </p>
            {!mailReminders.length && <p className="profile-empty-note">Nothing due for a mail right now.</p>}
            {!!mailReminders.length && (
              <ul className="dashboard-reminder-list">
                {mailReminders.map((r) => (
                  <li key={`${r.key}-${r.gear}-${r.level}`}>
                    <button type="button" onClick={() => jump(r.sheetName, r.key)}>
                      {r.person.name} — Gear {r.gear} ({r.label}): {r.level} mail due (Day {r.person.currentDay})
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dashboard-section">
            <h2>Effort goal</h2>
            <p className="issues-subtitle">
              Today's counts vs. target — {effortSummary?.targets.prepared ?? 30}/day per Team Member preparing diets,
              {' '}{effortSummary?.targets.verified ?? 45}/day per Team Leader verifying them.
            </p>
            {!effortSummary || !Object.keys(effortSummary.counts).length ? (
              <p className="profile-empty-note">No preps or verifications logged yet today.</p>
            ) : (
              <div className="effort-goal-grid">
                {Object.entries(effortSummary.counts).map(([name, c]) => (
                  <div key={name} className="effort-goal-card">
                    <span className="effort-goal-name">{name}</span>
                    {c.prepared > 0 && (
                      <span className={`effort-goal-stat${c.prepared >= effortSummary.targets.prepared ? ' effort-goal-stat-met' : ''}`}>
                        Prepared {c.prepared} / {effortSummary.targets.prepared}
                      </span>
                    )}
                    {c.verified > 0 && (
                      <span className={`effort-goal-stat${c.verified >= effortSummary.targets.verified ? ' effort-goal-stat-met' : ''}`}>
                        Verified {c.verified} / {effortSummary.targets.verified}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="dashboard-section">
            <h2>Diet preparation % / verification %</h2>
            <p className="issues-subtitle">
              "On time" can only be measured from when someone uses Mark Prepared, so this fills in gradually as the
              team uses it — it won't reflect diets prepared before this feature existed.
            </p>
            <div className="team-performance-grid">
              {[4, 3, 2].map((gear) => {
                const perf = teamPerformance[gear];
                return (
                  <div key={gear} className="team-performance-card">
                    <h3>Gear {gear}</h3>
                    <div className="team-performance-row">
                      <span>Preparation</span>
                      <span>{perf.preparation.pct === null ? '—' : `${perf.preparation.pct}%`} ({perf.preparation.onTime}/{perf.preparation.eligible})</span>
                    </div>
                    <div className="team-performance-row">
                      <span>Verification</span>
                      <span>{perf.verification.pct === null ? '—' : `${perf.verification.pct}%`} ({perf.verification.done}/{perf.verification.eligible})</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default Dashboard;
