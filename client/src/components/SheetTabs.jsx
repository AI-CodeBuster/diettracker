// Which spreadsheet tab is active — a dropdown next to the search bar
// (rather than a row of pill buttons) so it reads as one filter control
// among the others there, matching the reference tracker layout.
function SheetTabs({ sheets, activeSheet, onSelect }) {
  return (
    <label className="sheet-tabs-dropdown">
      <span className="sheet-tabs-dropdown-icon" aria-hidden="true">☰</span>
      <select aria-label="Sheet filter" value={activeSheet || ''} onChange={(e) => onSelect(e.target.value)}>
        {sheets.map((s) => (
          <option key={s.name} value={s.name}>{s.label}</option>
        ))}
      </select>
    </label>
  );
}

export default SheetTabs;
