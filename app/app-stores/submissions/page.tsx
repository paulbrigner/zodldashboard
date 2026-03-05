import Link from "next/link";
import {
  CHECKLIST_STATUS_LABELS,
  READINESS_GATE_LABELS,
  STORE_LABELS,
  SUBMISSION_STATUS_LABELS,
  getAppStoresDataset,
} from "@/lib/app-stores/data";
import { formatDate, getSubmissionById, sortSubmissionsNewestFirst } from "@/lib/app-stores/insights";

const STATUS_CLASS_MAP: Record<string, string> = {
  approved: "pill pill-status-good",
  completed: "pill pill-status-good",
  in_review: "pill pill-status-warn",
  in_progress: "pill pill-status-warn",
  submitted: "pill pill-status-warn",
  developer_action_required: "pill pill-status-bad",
  rejected: "pill pill-status-bad",
  removed: "pill pill-status-bad",
  blocked: "pill pill-status-bad",
};

function statusClass(status: string): string {
  return STATUS_CLASS_MAP[status] || "pill";
}

type SubmissionsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asString(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0] || null;
  return null;
}

export default async function AppStoresSubmissionsPage({ searchParams }: SubmissionsPageProps) {
  const data = getAppStoresDataset();
  const submissions = sortSubmissionsNewestFirst(data.submissions);
  const params = (await searchParams) || {};
  const selectedId = asString(params.submission) || submissions[0]?.id || null;
  const selected = getSubmissionById(data, selectedId);

  return (
    <div className="appstores-page-body">
      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Submission Runs</h2>
          <p className="subtle-text">One row per submission attempt with blocker and ownership visibility.</p>
        </header>

        <div className="appstores-table-wrap">
          <table className="appstores-table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Platform</th>
                <th>Version</th>
                <th>Track</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Owner (Eng)</th>
                <th>Approver (Policy/Legal)</th>
                <th>Links</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => (
                <tr key={submission.id}>
                  <td>{STORE_LABELS[submission.store]}</td>
                  <td>{submission.platform}</td>
                  <td>
                    {submission.appVersion} ({submission.buildNumber})
                  </td>
                  <td>{submission.track}</td>
                  <td>{formatDate(submission.submissionDate)}</td>
                  <td>
                    <span className={statusClass(submission.status)}>{SUBMISSION_STATUS_LABELS[submission.status]}</span>
                  </td>
                  <td>{submission.ownerEngineering}</td>
                  <td>{submission.approverPolicyLegal}</td>
                  <td>
                    <div className="appstores-inline-links">
                      <Link className="button button-secondary button-small" href={`/app-stores/submissions?submission=${submission.id}#detail`}>
                        Open detail
                      </Link>
                      <a className="button button-secondary button-small" href={submission.consoleUrl} rel="noreferrer" target="_blank">
                        Console
                      </a>
                    </div>
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
              Submission Detail: {STORE_LABELS[selected.store]} {selected.platform} {selected.appVersion} ({selected.buildNumber})
            </h2>
            <span className={statusClass(selected.readinessGate)}>{READINESS_GATE_LABELS[selected.readinessGate]} gate</span>
          </header>

          <div className="appstores-two-column">
            <article className="appstores-detail-card">
              <h3>What changed</h3>
              <p>{selected.whatChanged}</p>
              <p className="subtle-text">Outcome: {selected.outcome}</p>
              <p className="subtle-text">Lessons learned: {selected.lessonsLearned}</p>
              <ul className="appstores-list-tight">
                {selected.declarationsTouched.map((rowId) => (
                  <li key={rowId}>{rowId}</li>
                ))}
              </ul>
            </article>

            <article className="appstores-detail-card">
              <h3>Assets and links</h3>
              <ul className="appstores-list-tight">
                {selected.assetsUsed.map((asset) => (
                  <li key={asset}>{asset}</li>
                ))}
              </ul>
              <div className="appstores-inline-links">
                <a className="button button-secondary button-small" href={selected.releaseNotesUrl} rel="noreferrer" target="_blank">
                  Release notes
                </a>
                <a className="button button-secondary button-small" href={selected.checklistSnapshotUrl} rel="noreferrer" target="_blank">
                  Checklist snapshot
                </a>
                <a className="button button-secondary button-small" href={selected.evidenceBundleUrl} rel="noreferrer" target="_blank">
                  Evidence bundle
                </a>
              </div>
            </article>
          </div>

          <article className="appstores-detail-card" id="readiness">
            <h3>Submission Readiness Checklist</h3>
            <p className="subtle-text">Immutable snapshot captured for this submission attempt.</p>
            <ul className="appstores-readiness-list">
              {selected.checklist.map((item) => (
                <li className="appstores-readiness-item" key={item.id}>
                  <div>
                    <p>{item.label}</p>
                    {item.note ? <p className="subtle-text">{item.note}</p> : null}
                  </div>
                  <span className={statusClass(item.status)}>{CHECKLIST_STATUS_LABELS[item.status]}</span>
                </li>
              ))}
            </ul>
          </article>

          {selected.blockers.length > 0 ? (
            <article className="appstores-detail-card">
              <h3>Current blockers</h3>
              <ul className="appstores-list-tight">
                {selected.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </article>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
