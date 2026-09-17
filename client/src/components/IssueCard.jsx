import { STATUS_ORDER, statusLabel, urgencyLabel, timeAgo } from '../lib/issueLabels';

function IssueCard({ issue, onStatusChange, canManage }) {
  return (
    <div className="issue-card">
      <span className="issue-card-icon" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M10 1.5 11.8 7.2 17.5 8 12.9 11.7 14.2 17.5 10 14.2 5.8 17.5 7.1 11.7 2.5 8 8.2 7.2 10 1.5Z"
            fill="currentColor"
          />
        </svg>
      </span>

      <div className="issue-card-body">
        <div className="issue-card-top">
          <span className="issue-card-code">{issue.code}</span>
          <h3 className="issue-card-title">{issue.title}</h3>
        </div>

        <div className="issue-card-meta">
          {canManage ? (
            <select
              className={`issue-badge issue-status-${issue.status}`}
              value={issue.status}
              onChange={(e) => onStatusChange(issue, e.target.value)}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          ) : (
            <span className={`issue-badge issue-status-${issue.status}`}>{statusLabel(issue.status)}</span>
          )}
          <span className={`issue-badge issue-urgency-${issue.urgency}`}>{urgencyLabel(issue.urgency)}</span>
          {issue.screen && <span className="issue-badge issue-screen-tag">{issue.screen}</span>}
          <span className="issue-card-reporter">
            {issue.raisedByName || issue.raisedByEmail || 'Someone'} · {timeAgo(issue.createdAt)}
          </span>
        </div>
      </div>

      <span className="issue-card-chevron" aria-hidden="true">›</span>
    </div>
  );
}

export default IssueCard;
