import {
  STORE_LABELS,
  SUBMISSION_STATUS_LABELS,
  getAppStoresDataset,
} from "@/lib/app-stores/data";
import {
  buildCriticalAlerts,
  buildDeclarationStatusSummary,
  computeOverviewKpis,
  formatDate,
  sortSubmissionsNewestFirst,
} from "@/lib/app-stores/insights";

function alertClass(severity: "critical" | "high" | "medium"): string {
  if (severity === "critical") return "pill pill-alert-critical";
  if (severity === "high") return "pill pill-alert-high";
  return "pill pill-alert-medium";
}

function statusClass(status: string): string {
  if (["approved", "completed"].includes(status)) return "pill pill-status-good";
  if (["in_review", "in_progress", "submitted"].includes(status)) return "pill pill-status-warn";
  if (["developer_action_required", "overdue", "rejected", "removed", "blocked"].includes(status)) {
    return "pill pill-status-bad";
  }
  return "pill";
}

export default async function AppStoresOverviewPage() {
  const data = getAppStoresDataset();
  const kpis = computeOverviewKpis(data);
  const alerts = buildCriticalAlerts(data);
  const submissions = sortSubmissionsNewestFirst(data.submissions).slice(0, 6);
  const declarationSummary = buildDeclarationStatusSummary(data);

  return (
    <div className="appstores-page-body">
      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Executive Overview</h2>
          <p className="subtle-text">What is blocking releases and what needs immediate compliance action.</p>
        </header>

        <div className="appstores-kpi-grid">
          <article className="appstores-kpi-card">
            <h3>Release Blockers</h3>
            <p className="appstores-kpi-value">{kpis.releaseBlockers}</p>
            <p className="subtle-text">Current release trains with active blockers.</p>
          </article>

          <article className="appstores-kpi-card">
            <h3>Upcoming Deadlines</h3>
            <p className="appstores-kpi-value">30d: {kpis.deadlines30d}</p>
            <p className="subtle-text">
              60d: {kpis.deadlines60d} | 90d: {kpis.deadlines90d}
            </p>
            <p className="subtle-text">
              Next: {kpis.nextDeadlineDate ? formatDate(kpis.nextDeadlineDate) : "No deadline set"}
            </p>
          </article>

          <article className="appstores-kpi-card">
            <h3>Open Reviewer Threads</h3>
            <p className="appstores-kpi-value">{kpis.openReviewerThreads}</p>
            <p className="subtle-text">Apple + Google unresolved case threads.</p>
          </article>

          <article className="appstores-kpi-card">
            <h3>High-Risk Jurisdictions Affected</h3>
            <p className="appstores-kpi-value">{kpis.highRiskJurisdictionsAffected}</p>
            <p className="subtle-text">Regions with unresolved declaration or licensing posture.</p>
          </article>

          <article className="appstores-kpi-card">
            <h3>Unreviewed Feature Changes</h3>
            <p className="appstores-kpi-value">{kpis.unreviewedFeatureChanges}</p>
            <p className="subtle-text">Release changes waiting on compliance review.</p>
          </article>
        </div>
      </section>

      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Critical Alerts</h2>
          <p className="subtle-text">Immediate attention items from declarations, submissions, and reviewer comms.</p>
        </header>

        {alerts.length === 0 ? (
          <p className="subtle-text">No critical alerts.</p>
        ) : (
          <ul className="appstores-alert-list">
            {alerts.map((alert) => (
              <li className="appstores-alert-item" key={alert.id}>
                <span className={alertClass(alert.severity)}>{alert.severity}</span>
                <p>{alert.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Current Release Trains</h2>
          <p className="subtle-text">iOS and Android pipeline status with owners and blockers.</p>
        </header>

        <div className="appstores-table-wrap">
          <table className="appstores-table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Platform</th>
                <th>Version</th>
                <th>Status</th>
                <th>Target date</th>
                <th>Owner</th>
                <th>Blockers</th>
              </tr>
            </thead>
            <tbody>
              {data.releaseTrains.map((train) => (
                <tr key={train.id}>
                  <td>{STORE_LABELS[train.store]}</td>
                  <td>{train.platform}</td>
                  <td>
                    {train.version} ({train.buildNumber})
                  </td>
                  <td>
                    <span className={statusClass(train.status)}>{SUBMISSION_STATUS_LABELS[train.status]}</span>
                  </td>
                  <td>{formatDate(train.targetDate)}</td>
                  <td>{train.owner}</td>
                  <td>
                    {train.blockers.length === 0 ? (
                      <span className="subtle-text">None</span>
                    ) : (
                      <ul className="appstores-list-tight">
                        {train.blockers.map((blocker) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Declarations Status by Store</h2>
          <p className="subtle-text">Coverage view across declaration types and risk status.</p>
        </header>

        <div className="appstores-table-wrap">
          <table className="appstores-table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Declaration type</th>
                <th>Completed</th>
                <th>In progress</th>
                <th>Needs attention</th>
                <th>Overdue</th>
                <th>Next deadline</th>
              </tr>
            </thead>
            <tbody>
              {declarationSummary.map((row) => (
                <tr key={`${row.store}-${row.declarationType}`}>
                  <td>{row.store === "google" ? "Google Play" : "Apple"}</td>
                  <td>{row.declarationType}</td>
                  <td>{row.completed}</td>
                  <td>{row.inProgress}</td>
                  <td>{row.needsAttention}</td>
                  <td>{row.overdue}</td>
                  <td>{row.nextDeadline ? formatDate(row.nextDeadline) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Recent Submission Attempts</h2>
          <p className="subtle-text">Latest pipeline runs with direct links and outcomes.</p>
        </header>

        <ul className="appstores-submission-list">
          {submissions.map((submission) => (
            <li className="appstores-submission-item" key={submission.id}>
              <div className="appstores-submission-top">
                <p>
                  {STORE_LABELS[submission.store]} {submission.platform} {submission.appVersion} ({submission.buildNumber})
                </p>
                <span className={statusClass(submission.status)}>{SUBMISSION_STATUS_LABELS[submission.status]}</span>
              </div>
              <p className="subtle-text">Submitted {formatDate(submission.submissionDate)}</p>
              <p>{submission.outcome}</p>
              <div className="appstores-inline-links">
                <a className="button button-secondary button-small" href={submission.consoleUrl} rel="noreferrer" target="_blank">
                  Store console
                </a>
                <a
                  className="button button-secondary button-small"
                  href={submission.evidenceBundleUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Evidence bundle
                </a>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
