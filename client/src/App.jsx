import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import SheetTabs from './components/SheetTabs';
import SearchBar from './components/SearchBar';
import PersonTable from './components/PersonTable';
import BatchCard from './components/BatchCard';
import GenericTable from './components/GenericTable';
import GearViewer from './components/GearViewer';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import IssuesPage from './components/IssuesPage';
import StudentsPage from './components/StudentsPage';
import RequirementsPage from './components/RequirementsPage';
import DietRemarksPage from './components/DietRemarksPage';
import TeamPage from './components/TeamPage';
import PatientDetailFieldsPage from './components/PatientDetailFieldsPage';
import TLVerifyModal from './components/TLVerifyModal';
import Dashboard from './components/Dashboard';
import PatientProfile from './components/PatientProfile';
import StatusFilter from './components/StatusFilter';
import SwitchSheetModal from './components/SwitchSheetModal';
import { matchesQuery, matchesQueryGeneric } from './lib/search';
import { supabase, supabaseConfigured } from './lib/supabaseClient';
import { apiFetch } from './lib/apiFetch';
import { patientKey } from './lib/patientKey';
import { deriveGearStatus, matchesGearFilter, indexStatuses } from './lib/gearStatus';
import { effectiveActionsState, matchesActionsFilter } from './lib/actionsFilter';
import { loadExternalSpreadsheet, saveExternalSpreadsheet, clearExternalSpreadsheet } from './lib/externalSpreadsheet';
import './App.css';

const AUTO_REFRESH_MS = 60_000;

function App() {
  // undefined = still checking for an existing session; null = logged out
  const [session, setSession] = useState(undefined);
  const [sheets, setSheets] = useState([]);
  const [activeSheet, setActiveSheet] = useState(null);
  const [sheetData, setSheetData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [manifestFiles, setManifestFiles] = useState([]);
  const [foodRules, setFoodRules] = useState([]);
  const [viewer, setViewer] = useState(null); // { person, gear }
  const [fullscreen, setFullscreen] = useState(false);
  const [section, setSection] = useState('tracker'); // 'tracker' | 'dashboard' | 'issues' | 'requirements' | 'diet-remarks' | 'students'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [role, setRole] = useState(null);
  const [statuses, setStatuses] = useState([]); // bulk /api/patient-status, shared by chips/filter/dashboard
  const [profileTarget, setProfileTarget] = useState(null); // person whose profile is open in the detail pane
  const [pendingProfileKey, setPendingProfileKey] = useState(null); // personKey to open once its sheet finishes loading (Dashboard -> Tracker jump)
  const [pendingRemarkTarget, setPendingRemarkTarget] = useState(null); // { personKey, gear, remarkKey } to open once its sheet finishes loading (Diet Remarks -> Tracker jump)
  const [scrollToRemarkKey, setScrollToRemarkKey] = useState(null); // handed to GearViewer once its target person/gear is open
  const [statusFilterGear, setStatusFilterGear] = useState(2);
  const [statusFilterStatus, setStatusFilterStatus] = useState('all');
  const [batchFilter, setBatchFilter] = useState('');
  const [externalSpreadsheet, setExternalSpreadsheet] = useState(() => loadExternalSpreadsheet()); // {id, title, sheets} | null — personal, per-browser (see lib/externalSpreadsheet.js)
  const [showSwitchSheetModal, setShowSwitchSheetModal] = useState(false);
  const [tlVerifyTarget, setTlVerifyTarget] = useState(null); // { person, gear }

  // On (the long-standing default): one sheet tab at a time, exactly as
  // before. Off: every person-sheet's rows combined into one list, filtered
  // by Health Coach instead of picking a sheet — a per-browser UI
  // preference, not tracker data, so it's read from localStorage the same
  // way externalSpreadsheet is, and survives a reload.
  const [sheetWiseFilterEnabled, setSheetWiseFilterEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('sheetWiseFilterEnabled');
      return saved === null ? true : saved === 'true';
    } catch { return true; }
  });
  const [hcFilter, setHcFilter] = useState('');
  const [actionsFilter, setActionsFilter] = useState('all');
  // The combined-mode counterpart of sheetData/loading/error/loadSheet below
  // — kept separate rather than reusing those, since sheet-wise filtering
  // can be flipped on and off without re-fetching whichever side isn't
  // currently in view.
  const [combinedRows, setCombinedRows] = useState([]);
  const [combinedFetchedAt, setCombinedFetchedAt] = useState(null);
  const [combinedLoading, setCombinedLoading] = useState(false);
  const [combinedError, setCombinedError] = useState(null);

  useEffect(() => {
    try { localStorage.setItem('sheetWiseFilterEnabled', String(sheetWiseFilterEnabled)); } catch { /* ignore */ }
  }, [sheetWiseFilterEnabled]);

  const statusMap = useMemo(() => indexStatuses(statuses), [statuses]);

  // With sheet-wise filtering off, `activeSheet` no longer names the one
  // sheet every visible row came from — combined rows are tagged with their
  // own origin sheet (`_sourceSheet`, set when they're fetched below) as
  // they're combined. Getting this wrong wouldn't just mislabel something:
  // markPrepared/TL-verification/patientKey all key off whichever sheet name
  // this resolves to, so a wrong answer here would write to (or read) the
  // wrong health coach's sheet entirely.
  const sheetNameFor = useCallback((person) => {
    if (!sheetWiseFilterEnabled && person && person._sourceSheet) return person._sourceSheet;
    return activeSheet;
  }, [sheetWiseFilterEnabled, activeSheet]);

  const reloadStatuses = useCallback(() => {
    apiFetch('/api/patient-status').then((r) => r.json()).then((d) => setStatuses(d.statuses || [])).catch(() => {});
  }, []);

  const openGear = useCallback((person, gear, remarkKey = null) => {
    setViewer({ person, gear });
    setScrollToRemarkKey(remarkKey);
    setProfileTarget(null);
    setFullscreen(false);
  }, []);

  const closeViewer = useCallback(() => {
    setViewer(null);
    setFullscreen(false);
  }, []);

  const openProfile = useCallback((person) => {
    setProfileTarget(person);
    setViewer(null);
    setFullscreen(false);
  }, []);

  const closeProfile = useCallback(() => setProfileTarget(null), []);

  const openTLVerify = useCallback((person, gear) => setTlVerifyTarget({ person, gear }), []);
  const closeTLVerify = useCallback(() => setTlVerifyTarget(null), []);

  // Dashboard drill-down / reminder click: switch to the Tracker section on
  // that person's sheet, then open their profile once that sheet's data has
  // actually loaded — the Dashboard's own fetched rows aren't the same
  // object references the Tracker view holds, so the jump is resolved by
  // personKey once matching data is available (see the effect below).
  const jumpToPerson = useCallback(({ sheetName, personKey: key }) => {
    setSection('tracker');
    setPendingProfileKey(key);
    setActiveSheet(sheetName);
    // The jump always lands on that person's OWN sheet, regardless of
    // whether sheet-wise filtering happened to be off a moment ago — the
    // pendingProfileKey effect below only ever looks in single-sheet
    // `sheetData`, never the combined rows.
    setSheetWiseFilterEnabled(true);
  }, []);

  // Diet Remarks page's own "click a patient name -> land on their
  // highlighted remark" jump — same shape as jumpToPerson above (switch to
  // Tracker, force sheet-wise filtering on, load the resolved sheet), but
  // resolves to the actual diet plan (GearViewer) at the right gear instead
  // of the generic profile, and carries the remarkKey through so the effect
  // below can scroll straight to that exact block once it's open. The
  // sheetName here comes already resolved by DietRemarksPage itself (it has
  // to search every sheet for a matching personKey — a remark's own row
  // never stores which sheet its patient is on, see dietRemarksStore.js).
  const jumpToRemark = useCallback(({ sheetName, personKey: key, gear, remarkKey }) => {
    setSection('tracker');
    setPendingRemarkTarget({ personKey: key, gear, remarkKey });
    setActiveSheet(sheetName);
    setSheetWiseFilterEnabled(true);
  }, []);

  // Switching (or resetting) the data source clears anything on screen that
  // came from the old one, rather than leaving a stale person/diet-plan
  // visible against the new sheet's data.
  const handleSwitchSheet = useCallback((spreadsheet) => {
    saveExternalSpreadsheet(spreadsheet);
    setExternalSpreadsheet(spreadsheet);
    setShowSwitchSheetModal(false);
    setSheetData(null);
    setViewer(null);
    setProfileTarget(null);
    setSection('tracker');
  }, []);

  const handleResetSheet = useCallback(() => {
    clearExternalSpreadsheet();
    setExternalSpreadsheet(null);
    setSheetData(null);
    setViewer(null);
    setProfileTarget(null);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Keep a CSS var in sync with the real header height so the side panel
  // can dock directly beneath it (the header's height changes with content
  // — search results count, sync status, error banners — so this can't be
  // a fixed number).
  //
  // This has to be a callback ref rather than a mount effect: the header
  // isn't in the DOM on the first render (the login screen is), and it
  // unmounts again whenever the Issues/Requirements sections take over. A
  // one-shot effect saw a null ref, bailed, and never re-ran, so the var
  // stayed unset — leaving the panel docked at the CSS fallback and sliding
  // its whole header (title, patient name, full-screen and close buttons)
  // underneath the taller real header, which paints over it.
  const headerObserverRef = useRef(null);
  const headerRef = useCallback((el) => {
    if (headerObserverRef.current) {
      headerObserverRef.current.disconnect();
      headerObserverRef.current = null;
    }
    if (!el) {
      // No header on screen — nothing for the panel to dock beneath.
      document.documentElement.style.setProperty('--header-h', '0px');
      return;
    }
    const setVar = () => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(el);
    headerObserverRef.current = ro;
  }, []);

  useEffect(() => {
    if (!session) return;
    apiFetch('/api/manifest').then((r) => r.json()).then((m) => setManifestFiles(m.files));
    apiFetch('/api/food-rules').then((r) => r.json()).then((d) => setFoodRules(d.rules || []));
    apiFetch('/api/profile').then((r) => r.json()).then((p) => setRole(p.role || null));
  }, [session]);

  // Which sheet tabs are available, and whether patient-status/weight data
  // gets loaded at all, both depend on which spreadsheet is active. Re-runs
  // whenever Switch Sheet / Reset to default changes externalSpreadsheet.
  useEffect(() => {
    if (!session) return;
    if (externalSpreadsheet) {
      setSheets(externalSpreadsheet.sheets);
      setActiveSheet(externalSpreadsheet.sheets[0]?.name ?? null);
      // Data-integrity boundary: never apply the default sheet's saved
      // statuses to a different spreadsheet's rows (see plan/App.css notes
      // near patientKey.js) — an unrelated spreadsheet could reuse a
      // Student ID that belongs to a real patient.
      setStatuses([]);
      return;
    }
    apiFetch('/api/sheets').then((r) => r.json()).then((list) => {
      setSheets(list);
      if (list.length) setActiveSheet(list[0].name);
    });
    reloadStatuses();
  }, [session, externalSpreadsheet, reloadStatuses]);

  const loadSheet = useCallback((name, { refresh } = {}) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (refresh) params.set('refresh', '1');
    if (externalSpreadsheet) params.set('spreadsheetId', externalSpreadsheet.id);
    const qs = params.toString();
    apiFetch(`/api/sheets/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSheetData(data);
      })
      .catch((err) => setError(String(err.message || err)))
      .finally(() => setLoading(false));
  }, [externalSpreadsheet]);

  // Sheet-wise filtering OFF: every configured sheet fetched in parallel
  // (same per-sheet endpoint `loadSheet` already uses — there's no
  // "give me every sheet's rows in one call" API), kept only where
  // `isPersonSheet` is true — a sheet only says so once its own content has
  // actually been read, never known in advance from sheets.config.json alone
  // — and combined into one list. Each row is tagged with the sheet it
  // actually came from (`_sourceSheet`), since `sheetNameFor` above needs it
  // for every per-person action once rows no longer all share one sheet.
  const loadAllPersonSheets = useCallback(({ refresh } = {}) => {
    if (!sheets.length) return;
    setCombinedLoading(true);
    setCombinedError(null);
    const params = new URLSearchParams();
    if (refresh) params.set('refresh', '1');
    if (externalSpreadsheet) params.set('spreadsheetId', externalSpreadsheet.id);
    const qs = params.toString();
    Promise.all(sheets.map((s) =>
      apiFetch(`/api/sheets/${encodeURIComponent(s.name)}${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((data) => ({ ok: true, config: s, data }))
        .catch((err) => ({ ok: false, config: s, error: String(err.message || err) }))
    )).then((results) => {
      const failed = results.filter((r) => !r.ok || r.data.error);
      const personSheets = results.filter((r) => r.ok && !r.data.error && r.data.isPersonSheet);
      const rows = personSheets.flatMap((r) => r.data.rows.map((p) => ({ ...p, _sourceSheet: r.data.sheet })));
      setCombinedRows(rows);
      setCombinedFetchedAt(new Date().toISOString());
      // Not fatal — the tracker still shows everyone the other sheets
      // returned; a single flaky sheet fetch shouldn't blank the whole
      // combined view the way it would block a single-sheet load.
      setCombinedError(failed.length ? `Couldn't load: ${failed.map((f) => f.config.label).join(', ')}` : null);
    }).finally(() => setCombinedLoading(false));
  }, [sheets, externalSpreadsheet]);

  const refreshCurrent = useCallback(() => {
    if (sheetWiseFilterEnabled) { if (activeSheet) loadSheet(activeSheet, { refresh: true }); } else loadAllPersonSheets({ refresh: true });
  }, [sheetWiseFilterEnabled, activeSheet, loadSheet, loadAllPersonSheets]);

  const toggleSheetWiseFilter = useCallback(() => {
    setSheetWiseFilterEnabled((v) => !v);
    setQuery('');
    setStatusFilterStatus('all');
    setBatchFilter('');
    setHcFilter('');
    // Whichever's currently open almost certainly belongs to the sheet/view
    // being switched away from — closing both avoids ending up with a
    // stale-looking panel open against a person no longer in view.
    setViewer(null);
    setProfileTarget(null);
  }, []);

  // Works against a "Switch sheet" custom spreadsheet too, unlike Mark Call
  // Done/weight history — this only ever writes into whichever spreadsheet's
  // own row it just read (see the matching comment in server/index.js), so a
  // custom sheet reusing a Student ID from the default tracker can't corrupt
  // anything the way a shared-Supabase-table write could.
  const submitTLVerify = useCallback(async ({ verified, dietAccuracy, dietQuality, remarks }) => {
    const { person, gear } = tlVerifyTarget;
    const sheetName = sheetNameFor(person);
    const qs = externalSpreadsheet ? `?spreadsheetId=${encodeURIComponent(externalSpreadsheet.id)}` : '';
    const res = await apiFetch(`/api/tl-verification/${encodeURIComponent(sheetName)}/${encodeURIComponent(person.studentId)}/gear/${gear}${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified, dietAccuracy, dietQuality, remarks }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save TL verification');
    setTlVerifyTarget(null);
    refreshCurrent();
  }, [tlVerifyTarget, sheetNameFor, externalSpreadsheet, refreshCurrent]);

  // Same reasoning as submitTLVerify above: writes into whichever
  // spreadsheet's own row it just read, so it's safe on a "Switch sheet"
  // spreadsheet too. Re-opens the profile against the freshly-reloaded sheet
  // data afterward (via pendingProfileKey) so the gear's new status shows
  // immediately instead of looking unchanged until the next auto-refresh.
  const markPrepared = useCallback(async (person, gear) => {
    const sheetName = sheetNameFor(person);
    const qs = externalSpreadsheet ? `?spreadsheetId=${encodeURIComponent(externalSpreadsheet.id)}` : '';
    const res = await apiFetch(`/api/mark-prepared/${encodeURIComponent(sheetName)}/${encodeURIComponent(person.studentId)}/gear/${gear}${qs}`, {
      method: 'PUT',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to mark prepared');
    setPendingProfileKey(patientKey(sheetName, person));
    refreshCurrent();
  }, [sheetNameFor, externalSpreadsheet, refreshCurrent]);

  useEffect(() => {
    if (!session || !activeSheet || !sheetWiseFilterEnabled) return;
    setQuery('');
    // A status pill left active from a previous sheet (e.g. "Verified" on
    // DD104) otherwise carries straight over to whichever sheet is opened
    // next, silently hiding everyone who doesn't match it there too — that
    // reads as "this sheet barely has any data" rather than "a filter is
    // still on".
    setStatusFilterStatus('all');
    setBatchFilter(''); // same reasoning — a batch left picked on the old sheet won't exist on the new one
    loadSheet(activeSheet);
  }, [session, activeSheet, sheetWiseFilterEnabled, loadSheet]);

  // The combined-mode counterpart of the effect above — fetches once
  // sheet-wise filtering is off and the sheet list is ready (loadAllPersonSheets
  // is a no-op with nothing to fetch until then).
  useEffect(() => {
    if (!session || sheetWiseFilterEnabled || !sheets.length) return;
    loadAllPersonSheets();
  }, [session, sheetWiseFilterEnabled, sheets, loadAllPersonSheets]);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => {
      if (sheetWiseFilterEnabled) { if (activeSheet) loadSheet(activeSheet); } else loadAllPersonSheets();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [session, sheetWiseFilterEnabled, activeSheet, loadSheet, loadAllPersonSheets]);

  // Sheet-wise filtering ON: exactly the single fetched `sheetData`, as
  // before. OFF: a synthesized stand-in wrapping the combined rows in the
  // same shape, so every downstream consumer (search, status pill, batch/HC
  // filters, the table itself) keeps reading one `effectiveSheetData` rather
  // than branching on the mode individually.
  const effectiveSheetData = useMemo(() => {
    if (sheetWiseFilterEnabled) return sheetData;
    return { sheet: null, isPersonSheet: true, isBatchSheet: false, rows: combinedRows, fetchedAt: combinedFetchedAt, cached: false };
  }, [sheetWiseFilterEnabled, sheetData, combinedRows, combinedFetchedAt]);
  const effectiveLoading = sheetWiseFilterEnabled ? loading : combinedLoading;
  const effectiveError = sheetWiseFilterEnabled ? error : combinedError;

  const queryFilteredRows = useMemo(() => {
    if (!effectiveSheetData) return [];
    const matcher = effectiveSheetData.isPersonSheet ? matchesQuery : matchesQueryGeneric;
    return effectiveSheetData.rows.filter((row) => matcher(row, query));
  }, [effectiveSheetData, query]);

  const statusFilteredRows = useMemo(() => {
    if (!effectiveSheetData || !effectiveSheetData.isPersonSheet || statusFilterStatus === 'all') return queryFilteredRows;
    return queryFilteredRows.filter((person) => {
      const key = patientKey(sheetNameFor(person), person);
      const row = statusMap.get(`${key}:${statusFilterGear}`);
      const status = deriveGearStatus(person, statusFilterGear, row && row.status);
      return matchesGearFilter(status, statusFilterStatus);
    });
  }, [queryFilteredRows, effectiveSheetData, sheetNameFor, statusMap, statusFilterGear, statusFilterStatus]);

  // Batch filter, then Health Coach — each its own header dropdown in
  // PersonTable (the coach one only shown/wired up once sheet-wise
  // filtering is off — see the JSX below), applied in series on top of
  // whichever rows survived the previous one, same pattern as the status
  // pill before either.
  const batchFilteredRows = useMemo(() => {
    if (!batchFilter) return statusFilteredRows;
    return statusFilteredRows.filter((person) => person.batch === batchFilter);
  }, [statusFilteredRows, batchFilter]);

  const filteredRows = useMemo(() => {
    if (!hcFilter) return batchFilteredRows;
    return batchFilteredRows.filter((person) => person.hcName === hcFilter);
  }, [batchFilteredRows, hcFilter]);

  // Actions-column status dropdown (PersonTable's "Actions" header) -- same
  // header-select pattern as Batch/Health Coach above, scoped to whichever
  // gear is currently selected up in StatusFilter (statusFilterGear), the
  // same gear the status pills already use. Purely additive: filteredRows
  // itself (used by SearchBar's count, BatchCard, GenericTable below) is
  // left completely untouched by this.
  const actionsFilteredRows = useMemo(() => {
    if (!effectiveSheetData || !effectiveSheetData.isPersonSheet || actionsFilter === 'all') return filteredRows;
    return filteredRows.filter((person) => {
      const key = patientKey(sheetNameFor(person), person);
      const row = statusMap.get(`${key}:${statusFilterGear}`);
      const state = effectiveActionsState(person, statusFilterGear, row && row.status);
      return matchesActionsFilter(state, actionsFilter);
    });
  }, [filteredRows, effectiveSheetData, sheetNameFor, statusMap, statusFilterGear, actionsFilter]);

  // Resolves a Dashboard/reminder jump: once the target sheet has loaded,
  // find the matching person by personKey and open their profile. Also
  // fires after Mark Prepared (see markPrepared above) — jumpToPerson always
  // forces sheet-wise filtering back on, but markPrepared can run from
  // EITHER mode, so this checks combined rows too rather than assuming
  // single-sheet `sheetData` is always the right place to look.
  useEffect(() => {
    if (!pendingProfileKey || !effectiveSheetData || !effectiveSheetData.isPersonSheet) return;
    if (sheetWiseFilterEnabled && effectiveSheetData.sheet !== activeSheet) return;
    const match = effectiveSheetData.rows.find((person) => patientKey(sheetNameFor(person), person) === pendingProfileKey);
    if (match) openProfile(match);
    setPendingProfileKey(null);
  }, [pendingProfileKey, effectiveSheetData, sheetWiseFilterEnabled, activeSheet, sheetNameFor, openProfile]);

  // Same resolution as the pendingProfileKey effect above, once jumpToRemark
  // has switched onto the target sheet — opens the diet plan itself (at the
  // remark's own gear) instead of the profile, and passes the remarkKey
  // through so GearViewer/DietTemplateView can scroll straight to it.
  useEffect(() => {
    if (!pendingRemarkTarget || !effectiveSheetData || !effectiveSheetData.isPersonSheet) return;
    if (sheetWiseFilterEnabled && effectiveSheetData.sheet !== activeSheet) return;
    const match = effectiveSheetData.rows.find((person) => patientKey(sheetNameFor(person), person) === pendingRemarkTarget.personKey);
    if (match) openGear(match, pendingRemarkTarget.gear, pendingRemarkTarget.remarkKey);
    setPendingRemarkTarget(null);
  }, [pendingRemarkTarget, effectiveSheetData, sheetWiseFilterEnabled, activeSheet, sheetNameFor, openGear]);

  if (!supabaseConfigured) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Supabase isn't configured</h1>
          <p>
            Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to{' '}
            <code>client/.env</code> (see <code>client/.env.example</code>), then restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  if (session === undefined) {
    return (
      <div className="auth-shell">
        <p>Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeSection={section}
        onSelect={setSection}
        userEmail={session.user.email}
        onLogout={() => supabase.auth.signOut()}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
        externalSpreadsheet={externalSpreadsheet}
        onOpenSwitchSheet={() => setShowSwitchSheetModal(true)}
        onResetSheet={handleResetSheet}
        isDeveloper={role === 'developer'}
        isTL={role === 'tl'}
      />

      {showSwitchSheetModal && (
        <SwitchSheetModal onCancel={() => setShowSwitchSheetModal(false)} onSwitch={handleSwitchSheet} />
      )}

      {tlVerifyTarget && (
        <TLVerifyModal
          person={tlVerifyTarget.person}
          gear={tlVerifyTarget.gear}
          onCancel={closeTLVerify}
          onSubmit={submitTLVerify}
        />
      )}

      <div className="app-content">
        {section === 'students' ? (
          <StudentsPage isTL={role === 'tl'} isDeveloper={role === 'developer'} />
        ) : section === 'issues' ? (
          <IssuesPage currentUserEmail={session.user.email} isDeveloper={role === 'developer'} />
        ) : section === 'requirements' ? (
          <RequirementsPage currentUserEmail={session.user.email} isDeveloper={role === 'developer'} />
        ) : section === 'diet-remarks' ? (
          <DietRemarksPage sheets={sheets} onJumpToRemark={jumpToRemark} />
        ) : section === 'team' ? (
          <TeamPage />
        ) : section === 'patient-detail-fields' ? (
          <PatientDetailFieldsPage />
        ) : section === 'dashboard' ? (
          <Dashboard sheets={sheets} onJumpToPerson={jumpToPerson} externalSpreadsheet={externalSpreadsheet} />
        ) : (
          <div className="app">
            <header className="app-header" ref={headerRef} style={fullscreen ? { display: 'none' } : undefined}>
              <div className="app-title-row">
                <h1>Dietitian Department Tracker</h1>
                <div className="app-title-actions">
                  <button
                    className="refresh-btn"
                    type="button"
                    onClick={refreshCurrent}
                    disabled={effectiveLoading}
                  >
                    {effectiveLoading ? 'Syncing…' : '⟳ Sync now'}
                  </button>
                </div>
              </div>
              {effectiveSheetData?.isPersonSheet && (
                <StatusFilter
                  people={queryFilteredRows}
                  sheetNameFor={sheetNameFor}
                  statusMap={statusMap}
                  gear={statusFilterGear}
                  onGearChange={setStatusFilterGear}
                  status={statusFilterStatus}
                  onStatusChange={setStatusFilterStatus}
                />
              )}
              <div className="search-row">
                <SearchBar value={query} onChange={setQuery} resultCount={filteredRows.length} totalCount={effectiveSheetData?.rows.length ?? 0} />
                {/* Sheet-wise filter toggle: On keeps the long-standing single-
                    sheet-tab-at-a-time behavior (the dropdown next to it);
                    Off combines every person-sheet into one list, filtered by
                    Health Coach instead (PersonTable's own header dropdown —
                    see hcFilter below) since there's no single sheet left to
                    pick from. */}
                <button
                  type="button"
                  className={`sheet-filter-toggle-btn${sheetWiseFilterEnabled ? ' sheet-filter-toggle-btn-on' : ''}`}
                  onClick={toggleSheetWiseFilter}
                  aria-pressed={sheetWiseFilterEnabled}
                  title={sheetWiseFilterEnabled ? 'Showing one sheet at a time — click to show all students instead' : 'Showing all students combined — click to filter by sheet instead'}
                >
                  <span className="sheet-filter-toggle-track"><span className="sheet-filter-toggle-thumb" /></span>
                  Sheet-wise filter: {sheetWiseFilterEnabled ? 'On' : 'Off'}
                </button>
                {sheetWiseFilterEnabled && <SheetTabs sheets={sheets} activeSheet={activeSheet} onSelect={setActiveSheet} />}
              </div>
              {effectiveSheetData?.fetchedAt && (
                <p className="sync-info">
                  {effectiveSheetData.cached ? 'Cached · ' : ''}Last synced {new Date(effectiveSheetData.fetchedAt).toLocaleTimeString()}
                  {!sheetWiseFilterEnabled && ` · ${sheets.length} sheets checked`}
                </p>
              )}
            </header>

            <main className="app-main">
              <div className="list-pane list-pane-full" style={fullscreen ? { display: 'none' } : undefined}>
                {effectiveError && <div className="error-banner">{effectiveError}</div>}
                {!effectiveSheetData && !effectiveError && <div className="loading-banner">Loading…</div>}

                {effectiveSheetData && effectiveSheetData.isPersonSheet && (
                  <>
                    <PersonTable
                      rows={actionsFilteredRows}
                      batchScopeRows={statusFilteredRows}
                      sheetNameFor={sheetNameFor}
                      statusMap={statusMap}
                      viewer={viewer}
                      onOpenGear={openGear}
                      onOpenProfile={openProfile}
                      canTLVerify={role === 'tl' || role === 'developer'}
                      onOpenTLVerify={openTLVerify}
                      batchFilter={batchFilter}
                      onBatchFilterChange={setBatchFilter}
                      hcFilter={hcFilter}
                      onHcFilterChange={!sheetWiseFilterEnabled ? setHcFilter : undefined}
                      actionsFilter={actionsFilter}
                      onActionsFilterChange={setActionsFilter}
                      actionsGear={statusFilterGear}
                      onActionsGearChange={setStatusFilterGear}
                    />
                    {!actionsFilteredRows.length && (
                      <p className="empty-state">
                        {query ? `No matches for "${query}".` : 'No one matches this filter.'}
                      </p>
                    )}
                  </>
                )}
                {effectiveSheetData && effectiveSheetData.isBatchSheet && (
                  <div className="person-list">
                    {filteredRows.map((batch) => (
                      <BatchCard key={`${batch.batch || ''}-${batch.rowIndex}`} batch={batch} />
                    ))}
                    {!filteredRows.length && (
                      <p className="empty-state">{query ? `No matches for "${query}".` : 'No batches found.'}</p>
                    )}
                  </div>
                )}

                {effectiveSheetData && !effectiveSheetData.isPersonSheet && !effectiveSheetData.isBatchSheet && (
                  <GenericTable headers={effectiveSheetData.headers} rows={filteredRows} />
                )}
              </div>
            </main>

            {viewer && (
              <div
                className="modal-overlay viewer-modal-overlay"
                onMouseDown={(e) => e.target === e.currentTarget && closeViewer()}
              >
                <GearViewer
                  key={`${viewer.person.studentId || viewer.person.name}-${viewer.gear}`}
                  person={viewer.person}
                  gear={viewer.gear}
                  manifestFiles={manifestFiles}
                  foodRules={foodRules}
                  sheetName={sheetNameFor(viewer.person)}
                  onClose={closeViewer}
                  fullscreen={fullscreen}
                  onToggleFullscreen={() => setFullscreen((v) => !v)}
                  isTL={role === 'tl' || role === 'developer'}
                  // A plain 'tl' account gets highlight + download only —
                  // no replace/add/remove/revert. A developer keeps full
                  // access (both highlight and edit) for testing.
                  canEdit={role !== 'tl'}
                  scrollToRemarkKey={scrollToRemarkKey}
                />
              </div>
            )}

            {profileTarget && (
              <div className="modal-overlay profile-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeProfile()}>
                <PatientProfile
                  key={`${profileTarget.studentId || profileTarget.name}-profile`}
                  person={profileTarget}
                  sheetName={sheetNameFor(profileTarget)}
                  onClose={closeProfile}
                  onOpenGear={openGear}
                  onStatusChanged={reloadStatuses}
                  isExternal={!!externalSpreadsheet}
                  onMarkPrepared={(gear) => markPrepared(profileTarget, gear)}
                  canTLVerify={role === 'tl' || role === 'developer'}
                  onOpenTLVerify={openTLVerify}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
