// Gear + lifecycle-status quick filter for the tracker list, modeled
// directly on IssuesPage.jsx's QUICK_FILTERS pill pattern (status pills
// with live counts) — applied here to gear status instead of issue status.
// Coaches work mostly gear-by-gear, so the status pills are scoped to one
// gear at a time via the small gear toggle above them.
import { useMemo } from 'react';
import { patientKey } from '../lib/patientKey';
import { deriveGearStatus, isUnverified } from '../lib/gearStatus';
import { STATUS_ORDER, statusLabel } from '../lib/gearStatusLabels';

// `sheetName` is a single string for the (still default) single-sheet case;
// `sheetNameFor(person)` is what App.jsx passes once sheet-wise filtering is
// off and `people` is combined from every sheet — each needs its OWN origin
// resolved for the statusMap lookup below, not one shared name.
function StatusFilter({ people, sheetName, sheetNameFor, statusMap, gear, onGearChange, status, onStatusChange }) {
  const counts = useMemo(() => {
    const c = { all: people.length, unverified: 0 };
    STATUS_ORDER.forEach((s) => { c[s] = 0; });
    people.forEach((person) => {
      const key = patientKey(sheetNameFor ? sheetNameFor(person) : sheetName, person);
      const row = statusMap && statusMap.get(`${key}:${gear}`);
      const s = deriveGearStatus(person, gear, row && row.status);
      c[s] += 1;
      if (isUnverified(s)) c.unverified += 1;
    });
    return c;
  }, [people, sheetName, sheetNameFor, statusMap, gear]);

  return (
    <div className="status-filter">
      <div className="status-filter-gears">
        {[2, 3, 4].map((g) => (
          <button
            key={g}
            type="button"
            className={`status-filter-gear-btn${gear === g ? ' status-filter-gear-btn-active' : ''}`}
            onClick={() => onGearChange(g)}
          >
            Gear {g}
          </button>
        ))}
      </div>
      <div className="status-filter-pills">
        <button
          type="button"
          className={`status-pill status-pill-all${status === 'all' ? ' status-pill-active' : ''}`}
          onClick={() => onStatusChange('all')}
        >
          All <span className="status-pill-count">{counts.all}</span>
        </button>
        {/* Cross-cutting shortcut for "who still needs a TL to sign off",
            which the per-status pills cannot express on their own — it spans
            Pending + Call Done + Prepared. */}
        <button
          type="button"
          className={`status-pill status-pill-unverified${status === 'unverified' ? ' status-pill-active' : ''}`}
          onClick={() => onStatusChange('unverified')}
        >
          Unverified <span className="status-pill-count">{counts.unverified}</span>
        </button>
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            className={`status-pill gear-status-${s.replace('_', '-')}${status === s ? ' status-pill-active' : ''}`}
            onClick={() => onStatusChange(s)}
          >
            {statusLabel(s)} <span className="status-pill-count">{counts[s]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default StatusFilter;
