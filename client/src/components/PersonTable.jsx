// Row/column table view for person sheets (Praveena, DD104, ...), replacing
// the earlier card list — dense, scannable columns plus a header-level
// dropdown filter on Batch, matching the reference tracker layout the user
// asked to match. Full patient detail (BMI, diet preference, blood
// findings, per-gear dates/remarks, activity...) lives in PatientProfile,
// opened by clicking the name — this table is for scanning/filtering, not
// showing everything at once.
import { useMemo } from 'react';
import { CONDITION_LABELS } from '../lib/labels';
import { detectPersonCondition } from '../lib/matchDiet';
import { patientKey } from '../lib/patientKey';
import { deriveGearStatus } from '../lib/gearStatus';
import { statusLabel, statusClass } from '../lib/gearStatusLabels';
import { gearDueBadge, gearBlockReason } from '../lib/gearBlock';
import { ACTIONS_FILTER_OPTIONS } from '../lib/actionsFilter';

function initials(name) {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function GearCell({ person, gear, statusRow, isActive, onOpenGear, canTLVerify, onOpenTLVerify }) {
  const status = deriveGearStatus(person, gear, statusRow && statusRow.status);
  const verified = person.gearTLVerified && person.gearTLVerified[gear];
  const canVerifyThisGear = canTLVerify && person.gearReady && person.gearReady[gear];
  const blockReason = gearBlockReason(person, gear);
  const due = !blockReason ? gearDueBadge(person, gear) : null;

  return (
    <span className="table-gear-cell">
      {blockReason ? (
        <span className={`gear-status-chip ${statusClass(status)}`} title={`Gear ${gear} — ${blockReason.hint}`}>
          G{gear} · {blockReason.label}
        </span>
      ) : (
        <button
          type="button"
          className={`gear-status-chip gear-status-chip-btn ${statusClass(status)}${isActive ? ' gear-status-chip-active' : ''}`}
          onClick={() => onOpenGear(person, gear)}
          title={`Open Gear ${gear} diet plan${due ? ` — ${due.text}` : ''}`}
        >
          G{gear} · {statusLabel(status)}
        </button>
      )}
      {canVerifyThisGear && (
        <button
          type="button"
          className={`tl-verify-btn${verified ? ' tl-verify-btn-done' : ''}`}
          onClick={() => onOpenTLVerify(person, gear)}
          title={`TL verification for Gear ${gear}`}
        >
          {verified ? '✓' : 'TL'}
        </button>
      )}
    </span>
  );
}

function PersonTable({
  rows, batchScopeRows, sheetName, sheetNameFor, statusMap, viewer, onOpenGear, onOpenProfile, canTLVerify, onOpenTLVerify,
  batchFilter, onBatchFilterChange, hcFilter, onHcFilterChange, actionsFilter, onActionsFilterChange,
  actionsGear, onActionsGearChange,
}) {
  // Sheet-wise filtering ON still passes a single `sheetName` string (every
  // visible row genuinely comes from that one sheet); OFF passes
  // `sheetNameFor(person)` instead, since rows are now combined from every
  // person-sheet and each needs its OWN origin resolved — a wrong sheet name
  // here would send a write (Mark Prepared, TL verification) to the wrong
  // tab entirely. Falling back to `sheetName` keeps this component working
  // unchanged for the (still default, still most common) single-sheet case.
  const resolveSheetName = sheetNameFor || (() => sheetName);
  const batchOptions = useMemo(() => {
    const seen = new Set();
    (batchScopeRows || rows).forEach((p) => { if (p.batch) seen.add(p.batch); });
    return [...seen].sort();
  }, [batchScopeRows, rows]);
  // Only relevant once sheet-wise filtering is off (the caller omits
  // onHcFilterChange entirely otherwise) — combining every health coach's
  // own sheet into one list is exactly the case where picking out just one
  // coach's students again becomes useful, the same way Batch already is.
  const hcOptions = useMemo(() => {
    if (!onHcFilterChange) return [];
    const seen = new Set();
    (batchScopeRows || rows).forEach((p) => { if (p.hcName) seen.add(p.hcName); });
    return [...seen].sort();
  }, [batchScopeRows, rows, onHcFilterChange]);

  return (
    <div className="person-table-wrap">
      <table className="person-table">
        <thead>
          <tr>
            <th>Lead</th>
            <th>
              {onHcFilterChange ? (
                <span className="person-table-th-filter">
                  Health Coach
                  <select
                    className="person-table-th-select"
                    value={hcFilter}
                    onChange={(e) => onHcFilterChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Filter by health coach"
                  >
                    <option value="">All health coaches</option>
                    {hcOptions.map((hc) => <option key={hc} value={hc}>{hc}</option>)}
                  </select>
                </span>
              ) : 'Health Coach'}
            </th>
            <th>Contact No.</th>
            <th>Condition</th>
            <th>
              <span className="person-table-th-filter">
                Batch
                <select
                  className="person-table-th-select"
                  value={batchFilter}
                  onChange={(e) => onBatchFilterChange(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Filter by batch"
                >
                  <option value="">All batches</option>
                  {batchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </span>
            </th>
            <th>
              <span className="person-table-th-filter">
                Actions
                <select
                  className="person-table-th-select"
                  value={actionsGear}
                  onChange={(e) => onActionsGearChange(Number(e.target.value))}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Filter by gear"
                >
                  <option value={2}>Gear 2</option>
                  <option value={3}>Gear 3</option>
                  <option value={4}>Gear 4</option>
                </select>
                <select
                  className="person-table-th-select"
                  value={actionsFilter}
                  onChange={(e) => onActionsFilterChange(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Filter by status"
                >
                  {ACTIONS_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((person) => {
            const detected = detectPersonCondition(person);
            const conditionText = CONDITION_LABELS[detected.conditions[0]] + (detected.comorbid ? ' + Gastric/Ulcer/Acidity' : '');
            const key = patientKey(resolveSheetName(person), person);
            return (
              <tr key={`${resolveSheetName(person)}-${person.studentId || ''}-${person.rowIndex}`}>
                <td>
                  <div className="person-table-lead">
                    <span className="person-avatar person-table-avatar">{initials(person.name)}</span>
                    <span>
                      <button type="button" className="person-name person-name-btn" onClick={() => onOpenProfile && onOpenProfile(person)}>
                        {person.name}
                      </button>
                      {person.studentId && <span className="person-table-lead-id">{person.studentId}</span>}
                    </span>
                  </div>
                </td>
                <td>{person.hcName || '—'}</td>
                <td>{person.contact || '—'}</td>
                <td>
                  <span
                    className={`tag tag-condition${detected.isDefaulted ? ' tag-condition-guess' : ''}`}
                    title={detected.isDefaulted ? 'No condition mentioned in their notes — defaulting to Diabetes (program default)' : undefined}
                  >
                    {conditionText}{detected.isDefaulted ? ' (assumed)' : ''}
                  </span>
                </td>
                <td>{person.batch || '—'}</td>
                <td>
                  <div className="table-gear-actions">
                    {[4, 3, 2].map((gear) => (
                      <GearCell
                        key={gear}
                        person={person}
                        gear={gear}
                        statusRow={statusMap && statusMap.get(`${key}:${gear}`)}
                        isActive={!!(viewer && viewer.person === person && viewer.gear === gear)}
                        onOpenGear={onOpenGear}
                        canTLVerify={canTLVerify}
                        onOpenTLVerify={onOpenTLVerify}
                      />
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default PersonTable;
