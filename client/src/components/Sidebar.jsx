const SHEET_NAME = 'DIETITIAN DEPARTMENT TRACKER';

const NAV_ITEMS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 15.5V9.5M10 15.5V4.5M17 15.5V11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'students',
    label: 'Register Student',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="7" r="3" stroke="currentColor" strokeWidth="1.6" />
        <path d="M2.5 17c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M15.5 4.5v4.4M13.3 6.7h4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'tracker',
    label: 'Dietitian Department Tracker',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    key: 'issues',
    label: 'Bugs & Enhancements',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M10 2.5 17.5 16H2.5L10 2.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M10 8v3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="10" cy="13.6" r="0.9" fill="currentColor" />
      </svg>
    ),
  },
  {
    key: 'requirements',
    label: 'Requirements',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="2.5" width="14" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M6.5 7h7M6.5 10h7M6.5 13h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'diet-remarks',
    label: 'Diet Remarks',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 4.5h14v9H8l-3 3v-3H3v-9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M6.5 8h7M6.5 10.5h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
];

const TEAM_NAV_ITEM = {
  key: 'team',
  label: 'Team',
  icon: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="7" cy="7" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.5 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="14.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12.5 16c0-2 1.6-3.4 3.7-3.4S17.5 14 17.5 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

const PATIENT_DETAIL_FIELDS_NAV_ITEM = {
  key: 'patient-detail-fields',
  label: 'Patient Details Edit',
  icon: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="2.5" width="14" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 6.5h7M6.5 9.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="6.5" y="12" width="2.2" height="2.2" rx="0.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 13.1h2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

function Sidebar({
  activeSection,
  onSelect,
  userEmail,
  onLogout,
  collapsed,
  onToggleCollapsed,
  externalSpreadsheet,
  onOpenSwitchSheet,
  onResetSheet,
  isDeveloper,
  isTL,
}) {
  // Team management stays developer-only; Patient Details Edit is TL-or-
  // developer — the same trust tier this app already gives a TL for raising
  // Diet Remarks / TL-verifying a plan, not Team's higher developer-only bar.
  let navItems = NAV_ITEMS;
  if (isDeveloper) navItems = [...navItems, TEAM_NAV_ITEM];
  if (isTL || isDeveloper) navItems = [...navItems, PATIENT_DETAIL_FIELDS_NAV_ITEM];
  return (
    <nav className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">DD</div>
        {!collapsed && (
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-title">Dietitian CRM</span>
            <span className="sidebar-brand-subtitle">{externalSpreadsheet ? externalSpreadsheet.title : SHEET_NAME}</span>
          </div>
        )}
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <div className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`sidebar-nav-item${activeSection === item.key ? ' sidebar-nav-item-active' : ''}`}
            onClick={() => onSelect(item.key)}
            title={item.label}
          >
            <span className="sidebar-nav-icon">{item.icon}</span>
            {!collapsed && <span className="sidebar-nav-label">{item.label}</span>}
          </button>
        ))}
      </div>

      <div className="sidebar-source">
        {!collapsed && (
          <span className="sidebar-source-label" title={externalSpreadsheet ? externalSpreadsheet.title : SHEET_NAME}>
            {externalSpreadsheet ? `Viewing: ${externalSpreadsheet.title}` : 'Viewing: live tracker sheet'}
          </span>
        )}
        <button
          type="button"
          className="sidebar-switch-sheet-btn"
          onClick={onOpenSwitchSheet}
          title="Switch sheet"
        >
          {collapsed ? '⇄' : '⇄ Switch sheet'}
        </button>
        {!collapsed && externalSpreadsheet && (
          <button type="button" className="sidebar-reset-sheet-btn" onClick={onResetSheet}>
            Reset to default
          </button>
        )}
      </div>

      <div className="sidebar-footer">
        {!collapsed && <span className="sidebar-user-email" title={userEmail}>{userEmail}</span>}
        <button type="button" className="sidebar-logout-btn" onClick={onLogout} title="Log out">
          {collapsed ? '⎋' : 'Log out'}
        </button>
      </div>
    </nav>
  );
}

export default Sidebar;
