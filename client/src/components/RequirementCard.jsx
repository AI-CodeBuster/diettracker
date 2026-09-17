import { STATUS_ORDER, statusLabel, priorityLabel } from '../lib/requirementLabels';
import { timeAgo } from '../lib/issueLabels';

// Reuses the exact same badge/card classes as IssueCard (they're already
// generic, not bug-specific) — a requirement's status pipeline maps 1:1 onto
// the same visual treatment: proposed~open, in_progress~in_progress,
// done~fixed, declined~wont_do.
const STATUS_BADGE_CLASS = {
  proposed: 'issue-status-open',
  in_progress: 'issue-status-in_progress',
  done: 'issue-status-fixed',
  declined: 'issue-status-wont_do',
};

function RequirementCard({ requirement, onStatusChange, canManage }) {
  return (
    <div className="issue-card">
      <span className="issue-card-icon" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="2.5" width="14" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M6.5 7h7M6.5 10h7M6.5 13h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>

      <div className="issue-card-body">
        <div className="issue-card-top">
          <span className="issue-card-code">{requirement.code}</span>
          <h3 className="issue-card-title">{requirement.title}</h3>
        </div>

        <div className="issue-card-meta">
          {canManage ? (
            <select
              className={`issue-badge ${STATUS_BADGE_CLASS[requirement.status]}`}
              value={requirement.status}
              onChange={(e) => onStatusChange(requirement, e.target.value)}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          ) : (
            <span className={`issue-badge ${STATUS_BADGE_CLASS[requirement.status]}`}>{statusLabel(requirement.status)}</span>
          )}
          <span className={`issue-badge issue-urgency-${requirement.priority}`}>{priorityLabel(requirement.priority)}</span>
          {requirement.area && <span className="issue-badge issue-screen-tag">{requirement.area}</span>}
          <span className="issue-card-reporter">
            {requirement.requestedByName || requirement.requestedByEmail || 'Someone'} · {timeAgo(requirement.createdAt)}
          </span>
        </div>
      </div>

      <span className="issue-card-chevron" aria-hidden="true">›</span>
    </div>
  );
}

export default RequirementCard;
