import { getAppStoresDataset } from "@/lib/app-stores/data";

function phaseBadge(value: "planned" | "active" | "manual_only" | "partial") {
  if (value === "active") return "pill pill-status-good";
  if (value === "partial" || value === "manual_only") return "pill pill-status-warn";
  return "pill";
}

export default async function AppStoresSettingsPage() {
  const data = getAppStoresDataset();

  return (
    <div className="appstores-page-body">
      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Roles & Permissions (MVP)</h2>
          <p className="subtle-text">Current expected operating model for app store compliance workflows.</p>
        </header>

        <div className="appstores-card-grid">
          <article className="appstores-detail-card">
            <h3>Engineering</h3>
            <ul className="appstores-list-tight">
              <li>Create releases/submissions.</li>
              <li>Edit technical feature definitions and metadata draft content.</li>
              <li>Attach implementation evidence.</li>
            </ul>
          </article>

          <article className="appstores-detail-card">
            <h3>Policy / Legal</h3>
            <ul className="appstores-list-tight">
              <li>Edit declarations and jurisdiction decisions.</li>
              <li>Approve or block submission readiness.</li>
              <li>Own reviewer-case response sign-off.</li>
            </ul>
          </article>

          <article className="appstores-detail-card">
            <h3>Leadership / Audit</h3>
            <ul className="appstores-list-tight">
              <li>Read-only overview and exports.</li>
              <li>Immutable snapshot review for submissions and evidence bundles.</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Integration Status</h2>
          <p className="subtle-text">Practical staged automation path from manual to selective ingestion.</p>
        </header>

        <div className="appstores-table-wrap">
          <table className="appstores-table">
            <thead>
              <tr>
                <th>Integration</th>
                <th>Status</th>
                <th>Current behavior</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>GitHub release/tag detection</td>
                <td>
                  <span className={phaseBadge(data.integrationStatus.githubReleases)}>
                    {data.integrationStatus.githubReleases.replaceAll("_", " ")}
                  </span>
                </td>
                <td>Manual release links are attached to submissions.</td>
                <td>Auto-create “feature impact review required” task when a new tag appears.</td>
              </tr>
              <tr>
                <td>Slack alerts</td>
                <td>
                  <span className={phaseBadge(data.integrationStatus.slackAlerts)}>
                    {data.integrationStatus.slackAlerts.replaceAll("_", " ")}
                  </span>
                </td>
                <td>No push alerts from this dashboard yet.</td>
                <td>Emit deadline and rejection alerts to policy channel.</td>
              </tr>
              <tr>
                <td>Store console ingestion</td>
                <td>
                  <span className={phaseBadge(data.integrationStatus.consoleIngestion)}>
                    {data.integrationStatus.consoleIngestion.replaceAll("_", " ")}
                  </span>
                </td>
                <td>Manual update + screenshot evidence capture.</td>
                <td>Best-effort API ingestion where available; retain screenshot fallback.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Workflow Configuration</h2>
          <p className="subtle-text">Submission Readiness gate settings and operating defaults.</p>
        </header>

        <div className="appstores-card-grid">
          <article className="appstores-detail-card">
            <h3>Gate policy</h3>
            <ul className="appstores-list-tight">
              <li>Green: submit allowed.</li>
              <li>Yellow: submit allowed with explicit risk acceptance.</li>
              <li>Red: submit blocked.</li>
            </ul>
          </article>

          <article className="appstores-detail-card">
            <h3>MVP persistence note</h3>
            <p>
              This alpha is currently seeded data to validate IA, workflow, and UX. Next step is to back these entities with
              Postgres tables and append-only audit records.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
