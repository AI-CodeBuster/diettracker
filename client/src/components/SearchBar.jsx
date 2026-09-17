function SearchBar({ value, onChange, resultCount, totalCount }) {
  return (
    <div className="search-bar">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name, student ID, batch or coach..."
        aria-label="Search people"
      />
      {value && (
        <button className="search-clear" onClick={() => onChange('')} type="button" aria-label="Clear search">
          ×
        </button>
      )}
      <span className="search-count">
        {resultCount} / {totalCount}
      </span>
    </div>
  );
}

export default SearchBar;
