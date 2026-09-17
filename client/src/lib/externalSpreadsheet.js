// Persists the "Switch Sheet" choice to this browser only (not shared with
// other staff, not stored server-side) — see the Switch Sheet plan for why
// this is deliberately personal rather than a shared default.
const STORAGE_KEY = 'diet-tracker.externalSpreadsheet';

function loadExternalSpreadsheet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.id && Array.isArray(parsed.sheets)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveExternalSpreadsheet(spreadsheet) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(spreadsheet));
  } catch {
    // Storage can throw (private browsing, quota) — switching still works
    // for the rest of this session, it just won't survive a reload.
  }
}

function clearExternalSpreadsheet() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export { loadExternalSpreadsheet, saveExternalSpreadsheet, clearExternalSpreadsheet };
