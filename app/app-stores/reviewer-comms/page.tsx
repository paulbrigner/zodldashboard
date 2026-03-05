import Link from "next/link";
import {
  CASE_STATUS_LABELS,
  CASE_TYPE_LABELS,
  STORE_LABELS,
  getAppStoresDataset,
} from "@/lib/app-stores/data";
import { formatDateTime, getCaseById, getEventsForCase, sortCasesNewestFirst } from "@/lib/app-stores/insights";

type ReviewerCommsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asString(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0] || null;
  return null;
}

function statusClass(status: string): string {
  if (status === "resolved") return "pill pill-status-good";
  if (status === "awaiting_response") return "pill pill-status-warn";
  return "pill pill-status-bad";
}

function severityClass(severity: string): string {
  if (severity === "critical" || severity === "high") return "pill pill-status-bad";
  if (severity === "medium") return "pill pill-status-warn";
  return "pill";
}

export default async function AppStoresReviewerCommsPage({ searchParams }: ReviewerCommsPageProps) {
  const data = getAppStoresDataset();
  const sortedCases = sortCasesNewestFirst(data.reviewerCases);
  const params = (await searchParams) || {};
  const caseId = asString(params.case);
  const selected = caseId ? getCaseById(data, caseId) || sortedCases[0] || null : sortedCases[0] || null;
  const events = selected ? getEventsForCase(data, selected.id) : [];

  return (
    <div className="appstores-page-body">
      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Reviewer Cases</h2>
          <p className="subtle-text">Apple + Google rejection, warning, inquiry, and escalation threads.</p>
        </header>

        <div className="appstores-table-wrap">
          <table className="appstores-table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Case type</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Opened</th>
                <th>Last activity</th>
                <th>Owner</th>
                <th>Affected versions</th>
                <th>Case detail</th>
              </tr>
            </thead>
            <tbody>
              {sortedCases.map((row) => (
                <tr key={row.id}>
                  <td>{STORE_LABELS[row.store]}</td>
                  <td>{CASE_TYPE_LABELS[row.caseType]}</td>
                  <td>
                    <span className={severityClass(row.severity)}>{row.severity}</span>
                  </td>
                  <td>
                    <span className={statusClass(row.status)}>{CASE_STATUS_LABELS[row.status]}</span>
                  </td>
                  <td>{formatDateTime(row.openedAt)}</td>
                  <td>{formatDateTime(row.lastActivityAt)}</td>
                  <td>{row.owner}</td>
                  <td>{row.affectedVersions.join(", ")}</td>
                  <td>
                    <Link className="button button-secondary button-small" href={`/app-stores/reviewer-comms?case=${row.id}#detail`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <section className="appstores-section" id="detail">
          <header className="appstores-section-header">
            <h2>
              Case Detail: {STORE_LABELS[selected.store]} / {CASE_TYPE_LABELS[selected.caseType]} / {selected.playbookTag}
            </h2>
            <span className={statusClass(selected.status)}>{CASE_STATUS_LABELS[selected.status]}</span>
          </header>

          <div className="appstores-two-column">
            <article className="appstores-detail-card">
              <h3>Policy citations quoted by reviewer</h3>
              <ul className="appstores-list-tight">
                {selected.policyCitations.map((cite) => (
                  <li key={cite}>{cite}</li>
                ))}
              </ul>

              <h3>Attachments</h3>
              <ul className="appstores-list-tight">
                {selected.attachments.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article className="appstores-detail-card">
              <h3>Resolution notes</h3>
              <p>{selected.resolutionNotes}</p>
              <p className="subtle-text">Owner: {selected.owner}</p>
              <p className="subtle-text">Affected versions: {selected.affectedVersions.join(", ")}</p>
              <p className="subtle-text">Draft response workflow: Eng draft → Policy review → Legal approve → Submit.</p>
            </article>
          </div>

          <article className="appstores-detail-card">
            <h3>Timeline</h3>
            {events.length === 0 ? (
              <p className="subtle-text">No events recorded.</p>
            ) : (
              <ol className="appstores-timeline-list">
                {events.map((event) => (
                  <li className="appstores-timeline-item" key={event.id}>
                    <p className="appstores-timeline-meta">
                      <strong>{event.author}</strong> via {event.channel} at {formatDateTime(event.timestamp)}
                    </p>
                    <p>{event.message}</p>
                  </li>
                ))}
              </ol>
            )}
          </article>
        </section>
      ) : null}
    </div>
  );
}
