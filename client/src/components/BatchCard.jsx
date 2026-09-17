// Card view for the coach-batch rollup sheets ("Batch Details", "DD104 -
// DD113 DATE") — shares the .person-card/.person-info/.gear-buttons shell
// and tag-pill styling with PersonTable's row detail, but built around a
// batch's own fields instead of a patient's, since these sheets have no
// Student Name/ID at all (see isBatchSheet in server/lib/sheetSchema.js).
// Person sheets themselves render as a table (PersonTable), not cards —
// this is the one place that shell still shows up as a card.

function initials(text) {
  return (text || '?').trim().slice(0, 2).toUpperCase();
}

const BATCH_STATUS_CLASS = {
  active: 'gear-status-verified',
};

function batchStatusClass(status) {
  return BATCH_STATUS_CLASS[(status || '').trim().toLowerCase()] || 'gear-status-pending';
}

// Matches the BMI-category color convention elsewhere in the app: green for
// solidly on-track, amber for borderline, red once it's clearly behind.
// Only ever sees data once a batch actually has an Efficiency value filled
// in — every batch in the current sheet is still mid-program with none yet.
function efficiencyClass(text) {
  const n = parseFloat(text);
  if (Number.isNaN(n)) return '';
  if (n >= 90) return 'tag-bmi-normal';
  if (n >= 70) return 'tag-bmi-underweight';
  return 'tag-bmi-obese';
}

function GearStatBox({ gear, stats }) {
  const hasData = stats && (stats.endDate || stats.actualEndDate || stats.efficiency);
  return (
    <span className={`batch-gear-stat${hasData ? '' : ' batch-gear-stat-empty'}`}>
      <span className="batch-gear-stat-label">Gear {gear}</span>
      {hasData ? (
        <>
          {stats.actualEndDate && <span className="batch-gear-stat-date">{stats.actualEndDate}</span>}
          {stats.efficiency && (
            <span className={`tag tag-bmi ${efficiencyClass(stats.efficiency)}`}>{stats.efficiency}</span>
          )}
        </>
      ) : (
        <span className="batch-gear-stat-date batch-gear-stat-muted">No data yet</span>
      )}
    </span>
  );
}

function BatchCard({ batch }) {
  return (
    <div className="person-card">
      <div className="person-avatar" title={batch.batch}>
        {initials(batch.batch)}
      </div>
      <div className="person-info">
        <div className="person-name-row">
          <span className="person-name">{batch.batch}</span>
          {batch.category && <span className="person-id">{batch.category}</span>}
        </div>
        <div className="person-status-row">
          {batch.batchStatus && (
            <span className={`gear-status-chip ${batchStatusClass(batch.batchStatus)}`}>{batch.batchStatus}</span>
          )}
          {batch.tlName && <span className="person-last-updated">TL: {batch.tlName}</span>}
          {batch.daysSinceJoined && <span className="person-last-updated">{batch.daysSinceJoined}d since joined</span>}
        </div>
        <div className="person-meta">
          {batch.hcName && <span className="tag tag-muted">HC: {batch.hcName}</span>}
          {batch.healthCoachName && batch.healthCoachName.toLowerCase() !== (batch.hcName || '').toLowerCase() && (
            <span className="tag tag-muted">Coach: {batch.healthCoachName}</span>
          )}
          {batch.courseStartDate && <span className="tag">Started {batch.courseStartDate}</span>}
          {batch.doh && <span className="tag">DOH {batch.doh}</span>}
          {batch.doe && <span className="tag">DOE {batch.doe}</span>}
          {batch.totalHandover && <span className="tag tag-muted">{batch.totalHandover} handed over</span>}
        </div>
      </div>
      <div className="gear-buttons">
        {[2, 3, 4].map((gear) => (
          <GearStatBox key={gear} gear={gear} stats={batch.batchGearStats && batch.batchGearStats[gear]} />
        ))}
      </div>
    </div>
  );
}

export default BatchCard;
