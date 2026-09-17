import { useEffect, useMemo, useState } from 'react';
import { CONDITION_LABELS, DIET_LABELS, LANGUAGE_LABELS } from '../lib/labels';
import { detectPersonCondition } from '../lib/matchDiet';
import { patientKey } from '../lib/patientKey';
import { apiFetch } from '../lib/apiFetch';
import { daysLeft } from '../lib/dates';
import { RANK, deriveGearStatus } from '../lib/gearStatus';
import { STATUS_ORDER, statusLabel, statusClass, timeAgo } from '../lib/gearStatusLabels';
import { parseHeightCm, parseWeightKg, computeBMI, bmiCategory, BMI_CATEGORY_LABELS, computeIBW } from '../lib/bmi';
import { activityLabel, activityIcon } from '../lib/activityLabels';
import { gearBlockReason } from '../lib/gearBlock';
import { FINDING_LABELS } from '../lib/bloodFindings';

const BLOOD_STATUS_LABELS = { done: 'Reviewed', pending: 'Awaiting approval', not_provided: 'Not provided' };
const BLOOD_STATUS_CLASS = { done: 'blood-status-done', pending: 'blood-status-pending', not_provided: 'blood-status-missing' };

function WeightTrend({ history }) {
  if (!history || history.length < 2) return null;
  const [latest, previous] = history; // server returns newest-first
  const delta = latest.weightKg - previous.weightKg;
  if (Math.abs(delta) < 0.05) return <span className="weight-trend weight-trend-flat">No change since {timeAgo(previous.recordedAt)}</span>;
  const gaining = delta > 0;
  return (
    <span className={`weight-trend ${gaining ? 'weight-trend-up' : 'weight-trend-down'}`}>
      {gaining ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}kg {gaining ? 'gained' : 'lost'} since {timeAgo(previous.recordedAt)}
    </span>
  );
}

function GearStatusRow({ gear, person, statusRow, onSetStatus, busy, isExternal, onMarkPrepared, markingPrepared, canTLVerify, onOpenTLVerify }) {
  const status = deriveGearStatus(person, gear, statusRow && statusRow.status);
  const rank = RANK[status];
  const gearDates = person.gearDates && person.gearDates[gear];
  const due = daysLeft(gearDates);
  const bloodStatus = person.gearBloodStatus && person.gearBloodStatus[gear];
  const verified = person.gearTLVerified && person.gearTLVerified[gear];
  const tlDate = person.gearTLVerificationDate && person.gearTLVerificationDate[gear];
  const tlRemarks = person.gearTLRemarks && person.gearTLRemarks[gear];

  return (
    <div className="profile-gear-row">
      <div className="profile-gear-row-head">
        <span className="profile-gear-label">Gear {gear}</span>
        <span className={`gear-status-chip ${statusClass(status)}`}>{statusLabel(status)}</span>
        {due && due.status === 'overdue' && <span className="profile-gear-due profile-gear-due-overdue">⚠ Overdue {due.days}d</span>}
        {due && due.status === 'upcoming' && due.days <= 7 && <span className="profile-gear-due profile-gear-due-soon">⚠ Due in {due.days}d</span>}
        {due && due.status === 'upcoming' && due.days > 7 && <span className="profile-gear-due">Due in {due.days}d</span>}
      </div>

      {/* The dates/status this gear's own row in the sheet already carries,
          surfaced explicitly rather than only folded into the status chip —
          Start/Due/Completed dates, blood-report checkpoint, and (once set)
          the TL's verification date and remarks. */}
      {(gearDates || bloodStatus !== undefined || verified) && (
        <div className="profile-gear-facts">
          {gearDates?.expected && <span className="profile-gear-fact">Start {gearDates.expected}</span>}
          {gearDates?.due && <span className="profile-gear-fact">Due {gearDates.due}</span>}
          {gearDates?.actual && <span className="profile-gear-fact profile-gear-fact-done">Completed {gearDates.actual}</span>}
          {bloodStatus !== undefined && (
            <span className={`profile-gear-fact blood-status-tag ${BLOOD_STATUS_CLASS[bloodStatus] || ''}`}>
              Blood report: {BLOOD_STATUS_LABELS[bloodStatus] || bloodStatus}
            </span>
          )}
          {verified && (
            <span className="profile-gear-fact profile-gear-fact-done">TL Verified{tlDate ? ` ${tlDate}` : ''}</span>
          )}
        </div>
      )}
      {tlRemarks && (
        <div className="profile-gear-remarks">
          <span className="profile-info-label">TL Remarks</span> {tlRemarks}
        </div>
      )}

      {/* Mark Prepared / TL Verify write straight into the sheet's own row
          (see server/lib/prepStatusWriter.js and tlVerificationWriter.js) —
          safe on an external "Switch sheet" spreadsheet too, unlike Call
          Done/Completed below which are keyed into this app's own Supabase
          tables by Student ID. */}
      <div className="profile-gear-row-actions">
        {rank < RANK.prepared && (
          <button
            type="button"
            className="profile-action-btn profile-action-btn-primary"
            disabled={markingPrepared}
            onClick={() => onMarkPrepared(gear)}
          >
            {markingPrepared ? 'Marking…' : 'Mark Prepared'}
          </button>
        )}
        {canTLVerify && person.gearReady && person.gearReady[gear] && (
          <button type="button" className="profile-action-btn" onClick={() => onOpenTLVerify(gear)}>
            {verified ? '✓ Verified — edit' : 'TL Verify'}
          </button>
        )}
      </div>

      {isExternal ? (
        <div className="profile-gear-row-meta">
          <span className="person-last-updated">Call Done/Completed aren't available while viewing an external spreadsheet.</span>
        </div>
      ) : (
        <>
          <div className="profile-gear-row-meta">
            {statusRow ? (
              <span className="person-last-updated">
                Marked {statusLabel(statusRow.status)} {timeAgo(statusRow.updatedAt)}
                {statusRow.updatedByName ? ` by ${statusRow.updatedByName}` : ''}
              </span>
            ) : (
              <span className="person-last-updated">Not yet updated</span>
            )}
          </div>
          <div className="profile-gear-row-actions">
            {statusRow && statusRow.status === 'call_done' ? (
              <button type="button" className="profile-action-btn" disabled={busy} onClick={() => onSetStatus(gear, null)}>
                Undo Call Done
              </button>
            ) : (
              <button type="button" className="profile-action-btn" disabled={busy} onClick={() => onSetStatus(gear, 'call_done')}>
                Mark Call Done
              </button>
            )}
            {rank >= RANK.prepared && (
              status === 'completed' ? (
                <button type="button" className="profile-action-btn" disabled={busy} onClick={() => onSetStatus(gear, null)}>
                  Undo Completed
                </button>
              ) : (
                <button type="button" className="profile-action-btn profile-action-btn-primary" disabled={busy} onClick={() => onSetStatus(gear, 'completed')}>
                  Mark Completed
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PatientProfile({ person, sheetName, onClose, onOpenGear, onStatusChanged, isExternal, onMarkPrepared, canTLVerify, onOpenTLVerify }) {
  const pKey = useMemo(() => patientKey(sheetName, person), [sheetName, person]);
  const [statuses, setStatuses] = useState({}); // gear -> row
  const [weightHistory, setWeightHistory] = useState([]);
  const [activity, setActivity] = useState([]);
  const [busyGear, setBusyGear] = useState(null);
  const [preparingGear, setPreparingGear] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // See the data-integrity note in lib/externalSpreadsheet.js / the Switch
    // Sheet plan: an external spreadsheet's rows never touch these
    // patientKey-scoped tables, so there's nothing to fetch here for them.
    if (isExternal) return;
    let cancelled = false;
    apiFetch(`/api/patient-status/${encodeURIComponent(pKey)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const byGear = {};
        (data.statuses || []).forEach((row) => { byGear[row.gear] = row; });
        setStatuses(byGear);
      })
      .catch(() => {});
    apiFetch(`/api/patient-weight/${encodeURIComponent(pKey)}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setWeightHistory(data.history || []); })
      .catch(() => {});
    apiFetch(`/api/patient-activity/${encodeURIComponent(pKey)}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled && !data.error) setActivity(data.events || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pKey, isExternal]);

  const urgentGears = useMemo(() => {
    return [2, 3, 4]
      .map((gear) => ({ gear, due: daysLeft(person.gearDates && person.gearDates[gear]) }))
      .filter(({ due }) => due && (due.status === 'overdue' || (due.status === 'upcoming' && due.days <= 7)));
  }, [person]);

  const handleSetStatus = async (gear, status) => {
    setBusyGear(gear);
    setError(null);
    const prev = statuses[gear];
    setStatuses((s) => ({ ...s, [gear]: status ? { ...s[gear], gear, status, updatedAt: new Date().toISOString() } : undefined }));
    try {
      const res = await apiFetch(`/api/patient-status/${encodeURIComponent(pKey)}/gear/${gear}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');
      setStatuses((s) => ({ ...s, [gear]: status ? data : undefined }));
      onStatusChanged && onStatusChanged();
    } catch (err) {
      setStatuses((s) => ({ ...s, [gear]: prev }));
      setError(String(err.message || err));
    } finally {
      setBusyGear(null);
    }
  };

  const handleMarkPrepared = async (gear) => {
    setPreparingGear(gear);
    setError(null);
    try {
      await onMarkPrepared(gear);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setPreparingGear(null);
    }
  };

  const detected = detectPersonCondition(person);
  const heightCm = parseHeightCm(person.height);
  const weightKg = parseWeightKg(person.weight);
  const bmi = computeBMI(heightCm, weightKg);
  const bmiCat = bmiCategory(bmi);
  const ibw = computeIBW(heightCm);

  return (
    <div className="panel profile-panel">
      <header className="panel-header">
        <div>
          <h2>Profile</h2>
          <p className="panel-subtitle">{person.name}{person.studentId ? ` · #${person.studentId}` : ''}</p>
        </div>
        <div className="panel-header-actions">
          <button className="panel-close" onClick={onClose} type="button" aria-label="Close">×</button>
        </div>
      </header>

      <div className="panel-body-wrap">
        <div className="panel-body profile-body">
          {error && <div className="error-banner">{error}</div>}

          {!!urgentGears.length && (
            <div className="profile-urgent-banner">
              ⚠ {urgentGears.map(({ gear, due }) => (
                <span key={gear} className="profile-urgent-item">
                  Gear {gear} {due.status === 'overdue' ? `overdue by ${due.days}d` : `due in ${due.days}d`}
                </span>
              ))}
            </div>
          )}

          <section className="profile-section">
            <h3>Basic details</h3>
            <div className="profile-info-grid">
              <div className="profile-info-item">
                <span className="profile-info-label">Student ID</span>
                <span className="profile-info-value">{person.studentId || '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Batch</span>
                <span className="profile-info-value">{person.batch || '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Health Coach</span>
                <span className="profile-info-value">{person.hcName || '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Contact Number</span>
                <span className="profile-info-value">{person.contact || '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Gender</span>
                <span className="profile-info-value">{person.gender || '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Age</span>
                <span className="profile-info-value">{person.age || '—'}</span>
              </div>
            </div>
          </section>

          <section className="profile-section">
            <h3>Clinical details</h3>
            <div className="profile-info-grid">
              <div className="profile-info-item">
                {/* Always shown in cm regardless of how it was entered
                    (the sheet mixes cm and feet.inches in one column with
                    no unit marker) — the management document requires
                    height display in cm; parseHeightCm already normalizes
                    it, this just surfaces that instead of the raw text. */}
                <span className="profile-info-label">Height</span>
                <span className="profile-info-value">{heightCm ? `${Math.round(heightCm)} cm` : (person.height || '—')}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Weight</span>
                <span className="profile-info-value">
                  {person.weight ? `${person.weight}kg` : '—'}
                  {weightHistory.length >= 2 && <WeightTrend history={weightHistory} />}
                </span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">BMI</span>
                <span className="profile-info-value">
                  {bmi ? (
                    <span className={`tag tag-bmi tag-bmi-${bmiCat}`}>{bmi.toFixed(1)} · {BMI_CATEGORY_LABELS[bmiCat]}</span>
                  ) : '—'}
                </span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">IBW</span>
                <span className="profile-info-value">{ibw ? `${Math.round(ibw)} kg` : '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Primary Condition</span>
                <span className="profile-info-value">{person.conditionRaw || CONDITION_LABELS[detected.conditions[0]]}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Secondary Condition</span>
                <span className="profile-info-value">{person.secondaryCondition || '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Past History / Other Symptoms</span>
                <span className="profile-info-value">{person.pastHistory || '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Supplement</span>
                <span className="profile-info-value">{person.supplement || '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Food Allergy</span>
                <span className="profile-info-value">{person.foodAllergy || '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Dislike Food</span>
                <span className="profile-info-value">{person.dislikeFood || '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Diet Preference</span>
                <span className="profile-info-value">{person.vegPreference ? DIET_LABELS[person.vegPreference] : '—'}</span>
              </div>
              <div className="profile-info-item">
                <span className="profile-info-label">Language</span>
                <span className="profile-info-value">{person.language ? LANGUAGE_LABELS[person.language] : '—'}</span>
              </div>
              {person.bloodReportDate && (
                <div className="profile-info-item">
                  <span className="profile-info-label">Blood Report Provided</span>
                  <span className="profile-info-value">{person.bloodReportDate}</span>
                </div>
              )}
            </div>
          </section>

          <section className="profile-section">
            <h3>Gear progress</h3>
            {[2, 3, 4].map((gear) => (
              <GearStatusRow
                key={gear}
                gear={gear}
                person={person}
                statusRow={statuses[gear]}
                busy={busyGear === gear}
                onSetStatus={handleSetStatus}
                isExternal={isExternal}
                onMarkPrepared={() => handleMarkPrepared(gear)}
                markingPrepared={preparingGear === gear}
                canTLVerify={canTLVerify}
                onOpenTLVerify={onOpenTLVerify ? () => onOpenTLVerify(person, gear) : undefined}
              />
            ))}
          </section>

          <section className="profile-section">
            <h3>Blood report findings</h3>
            {[2, 3, 4].map((gear) => {
              const findings = person.gearBloodFindings && person.gearBloodFindings[gear];
              if (!findings) return null;
              const entries = Object.entries(findings).filter(([, v]) => v);
              if (!entries.length) return null;
              return (
                <div key={gear} className="profile-findings-block">
                  <span className="profile-gear-label">Gear {gear}</span>
                  <div className="profile-info-grid">
                    {entries.map(([k, v]) => (
                      <div key={k} className="profile-info-item">
                        <span className="profile-info-label">{FINDING_LABELS[k] || k}</span>
                        <span className="profile-info-value">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {[2, 3, 4].every((g) => !person.gearBloodFindings || !person.gearBloodFindings[g]) && (
              <p className="profile-empty-note">No blood report findings on file.</p>
            )}
          </section>

          <section className="profile-section">
            <h3>Diet plans</h3>
            <div className="profile-gear-links">
              {[2, 3, 4].map((gear) => {
                const blockReason = gearBlockReason(person, gear);
                if (blockReason) {
                  return (
                    <span key={gear} className="gear-blocked" title={`Gear ${gear} — ${blockReason.hint}`}>
                      Gear {gear}
                      <span className="gear-blocked-reason">{blockReason.label}</span>
                    </span>
                  );
                }
                return (
                  <button key={gear} type="button" className="profile-action-btn" onClick={() => onOpenGear(person, gear)}>
                    Open Gear {gear} plan
                  </button>
                );
              })}
            </div>
          </section>

          {!isExternal && (
            <section className="profile-section">
              <h3>Recent activity</h3>
              {!activity.length ? (
                <p className="profile-empty-note">No activity logged yet from inside the app.</p>
              ) : (
                <ul className="profile-activity-list">
                  {activity.map((event, i) => (
                    <li key={i} className="profile-activity-item">
                      <span className="profile-activity-icon">{activityIcon(event)}</span>
                      <span className="profile-activity-text">{activityLabel(event)}</span>
                      <span className="profile-activity-time">{timeAgo(event.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default PatientProfile;
