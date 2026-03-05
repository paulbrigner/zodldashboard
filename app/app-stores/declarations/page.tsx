import Link from "next/link";
import {
  DECLARATION_DECISION_LABELS,
  DECLARATION_STATUS_LABELS,
  STORE_LABELS,
  getAppStoresDataset,
} from "@/lib/app-stores/data";
import { formatDate } from "@/lib/app-stores/insights";

type DeclarationsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asString(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0] || null;
  return null;
}

function statusClass(status: string): string {
  if (status === "completed") return "pill pill-status-good";
  if (status === "in_progress" || status === "needs_update") return "pill pill-status-warn";
  if (status === "overdue") return "pill pill-status-bad";
  return "pill";
}

export default async function AppStoresDeclarationsPage({ searchParams }: DeclarationsPageProps) {
  const data = getAppStoresDataset();
  const declarations = [...data.declarations].sort((a, b) => a.regionLabel.localeCompare(b.regionLabel));
  const dsaDeclaration = declarations.find((row) => row.id === "decl-apple-dsa-eu") || null;
  const params = (await searchParams) || {};
  const declarationId = asString(params.declaration);
  const selected = declarationId
    ? declarations.find((row) => row.id === declarationId) || declarations[0] || null
    : declarations[0] || null;

  return (
    <div className="appstores-page-body">
      {dsaDeclaration ? (
        <section className="appstores-section">
          <header className="appstores-section-header">
            <h2>DSA Trader Status Tracker</h2>
            <span className={statusClass(dsaDeclaration.status)}>
              {DECLARATION_STATUS_LABELS[dsaDeclaration.status]}
            </span>
          </header>

          <div className="appstores-two-column">
            <article className="appstores-detail-card">
              <h3>Question prompt</h3>
              <p>{dsaDeclaration.questionPrompt || dsaDeclaration.declarationType}</p>
              <p className="subtle-text">Region: {dsaDeclaration.regionLabel}</p>
              <p className="subtle-text">Selected response:</p>
              <p>
                <strong>{dsaDeclaration.selectedResponse || "Not recorded"}</strong>
              </p>
            </article>

            <article className="appstores-detail-card">
              <h3>Impact and review</h3>
              <p>{dsaDeclaration.responseImpact || "No impact note recorded."}</p>
              <p className="subtle-text">Effective: {formatDate(dsaDeclaration.effectiveDate)}</p>
              <p className="subtle-text">Next review: {formatDate(dsaDeclaration.updateByDate)}</p>
              <p className="subtle-text">
                Sign-off:{" "}
                {dsaDeclaration.signOffBy
                  ? `${dsaDeclaration.signOffBy} (${formatDate(dsaDeclaration.signOffDate || dsaDeclaration.updateByDate)})`
                  : "Pending"}
              </p>
            </article>
          </div>
        </section>
      ) : null}

      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Declaration Coverage</h2>
          <p className="subtle-text">Per-region status, deadlines, documentation requirements, and sign-off state.</p>
        </header>

        <div className="appstores-table-wrap">
          <table className="appstores-table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Declaration type</th>
                <th>Scope</th>
                <th>Country/Region</th>
                <th>Status</th>
                <th>Deadline</th>
                <th>Requires docs?</th>
                <th>License determination</th>
                <th>Sign-off</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {declarations.map((row) => (
                <tr key={row.id}>
                  <td>{STORE_LABELS[row.store]}</td>
                  <td>{row.declarationType}</td>
                  <td>{row.scope === "all_regions" ? "All regions" : "Per region"}</td>
                  <td>{row.regionLabel}</td>
                  <td>
                    <span className={statusClass(row.status)}>{DECLARATION_STATUS_LABELS[row.status]}</span>
                  </td>
                  <td>{formatDate(row.updateByDate)}</td>
                  <td>{row.requiresDocs}</td>
                  <td>{DECLARATION_DECISION_LABELS[row.internalDetermination]}</td>
                  <td>
                    {row.signOffBy ? `${row.signOffBy} (${formatDate(row.signOffDate || row.updateByDate)})` : "Pending"}
                  </td>
                  <td>
                    <Link className="button button-secondary button-small" href={`/app-stores/declarations?declaration=${row.id}#detail`}>
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
              Country/Region Detail: {selected.regionLabel} ({STORE_LABELS[selected.store]})
            </h2>
            <span className={statusClass(selected.status)}>{DECLARATION_STATUS_LABELS[selected.status]}</span>
          </header>

          <div className="appstores-two-column">
            <article className="appstores-detail-card">
              <h3>Declaration answers snapshot</h3>
              <p>{selected.answersSnapshot}</p>
              {selected.selectedResponse ? (
                <p className="subtle-text">
                  Selected response: <strong>{selected.selectedResponse}</strong>
                </p>
              ) : null}
              <p className="subtle-text">Effective: {formatDate(selected.effectiveDate)}</p>
              <p className="subtle-text">Update by: {formatDate(selected.updateByDate)}</p>
            </article>

            <article className="appstores-detail-card">
              <h3>License required decision record</h3>
              <p>
                Decision: <strong>{DECLARATION_DECISION_LABELS[selected.internalDetermination]}</strong>
              </p>
              <p>{selected.rationale}</p>
              <p className="subtle-text">Notes: {selected.notes}</p>
            </article>
          </div>

          <article className="appstores-detail-card">
            <h3>Source links and evidence pointers</h3>
            <ul className="appstores-list-tight">
              {selected.sourceLinks.map((link) => (
                <li key={link}>{link}</li>
              ))}
            </ul>
            <p className="subtle-text">
              Full evidence references are available in <Link href="/app-stores/evidence-vault">Evidence Vault</Link>.
            </p>
          </article>
        </section>
      ) : null}
    </div>
  );
}
