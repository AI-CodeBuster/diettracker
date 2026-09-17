// Fallback view for sheets that aren't structured as a person+gear list
// (e.g. "Batch Details", which is batch-level roll-up data).
function GenericTable({ headers, rows }) {
  const cols = headers.filter((h) => h && h.trim());
  return (
    <div className="generic-table-wrap">
      <table className="generic-table">
        <thead>
          <tr>{cols.map((h, i) => <th key={i} className={i === 0 ? 'generic-table-pin' : undefined}>{h.replace(/\s+/g, ' ').trim()}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {cols.map((h, i) => (
                <td key={i} className={i === 0 ? 'generic-table-pin' : undefined}>
                  {r.raw[h.replace(/\s+/g, ' ').trim()] || ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default GenericTable;
