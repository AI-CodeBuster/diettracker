// Shared by DietTemplateView.jsx (recipe cards/lines, Diet Schedule tables)
// and PatientCoverPage.jsx (Personal Details / Diet & Other Preference /
// Clinical Details fields) -- the same TL "highlight mode" flag/badge button,
// and the same exact-substring highlight renderer, wherever a remarkable
// block of text can appear in the plan. Kept in its own file rather than
// inside DietTemplateView.jsx (which renders PatientCoverPage) to avoid a
// circular import.

// Renders as either: nothing (no remark here, and this viewer isn't a TL in
// highlight mode); a small "flag" button a TL in highlight mode can click to
// raise a new remark on this exact block; or, once one exists, a "💬" badge
// anyone can click to read it (and, if pending, resolve it) — the SAME badge
// for a TL or a coach, since both need to reach the same modal.
function RemarkFlag({ remarkKey, remarkCtx, gear, highlightedText }) {
  if (!remarkCtx) return null;
  const pending = remarkCtx.pendingByKey.get(remarkKey);
  if (pending) {
    return (
      <button
        type="button"
        className="diet-remark-badge"
        onClick={(e) => { e.stopPropagation(); remarkCtx.onOpen(pending); }}
        title={`TL remark from ${pending.raisedByName} — click to view`}
      >
        💬
      </button>
    );
  }
  if (remarkCtx.canRaise) {
    return (
      <button
        type="button"
        className="diet-remark-flag-btn"
        onClick={(e) => { e.stopPropagation(); remarkCtx.onRaise(gear, remarkKey, highlightedText); }}
        title="Highlight this for the coach"
      >
        🖍
      </button>
    );
  }
  return null;
}

// Wraps the EXACT substring a TL originally selected (pending.highlightedText,
// captured verbatim by handleRemarkTextSelection at raise time) inside `text`,
// instead of the caller highlighting its whole row/cell/line. Returns null
// (caller keeps its own whole-block fallback) when that substring can no
// longer be found verbatim in `text` — e.g. a remark raised via the 🖍 flag
// button itself (whose highlightedText is a synthetic whole-row/whole-field
// label, not a real selection) or sheet content that changed after the
// remark was raised.
function renderWithHighlight(text, highlightedText, className) {
  if (typeof text !== 'string' || !highlightedText) return null;
  const idx = text.indexOf(highlightedText);
  if (idx === -1) return null;
  return (
    <>
      {text.slice(0, idx)}
      <mark className={className}>{text.slice(idx, idx + highlightedText.length)}</mark>
      {text.slice(idx + highlightedText.length)}
    </>
  );
}

export { RemarkFlag, renderWithHighlight };
