import Link from "next/link";
import { STORE_LABELS, getAppStoresDataset } from "@/lib/app-stores/data";
import { formatDate, getEvidenceForSubmission } from "@/lib/app-stores/insights";

type EvidenceVaultPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asString(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0] || null;
  return null;
}

export default async function AppStoresEvidenceVaultPage({ searchParams }: EvidenceVaultPageProps) {
  const data = getAppStoresDataset();
  const params = (await searchParams) || {};
  const selectedBundleId = asString(params.bundle);
  const selectedBundle = selectedBundleId
    ? data.evidenceBundles.find((row) => row.id === selectedBundleId) || data.evidenceBundles[0] || null
    : data.evidenceBundles[0] || null;

  const bundleSubmissionId = selectedBundle?.submissionId || data.evidenceBundles[0]?.submissionId;
  const evidenceBundleData = bundleSubmissionId ? getEvidenceForSubmission(data, bundleSubmissionId) : { bundle: null, items: [] };

  return (
    <div className="appstores-page-body">
      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Evidence Inventory</h2>
          <p className="subtle-text">
            Structured repository for legal, policy, declaration, and technical artifacts used in app store submissions.
          </p>
        </header>

        <div className="appstores-table-wrap">
          <table className="appstores-table appstores-table-dense">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Jurisdictions</th>
                <th>Features</th>
                <th>Stores</th>
                <th>Effective range</th>
                <th>Owner / approver</th>
                <th>Confidentiality</th>
                <th>Storage ref</th>
              </tr>
            </thead>
            <tbody>
              {data.evidenceItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{item.evidenceType.replaceAll("_", " ")}</td>
                  <td>{item.jurisdictions.join(", ")}</td>
                  <td>{item.features.join(", ")}</td>
                  <td>{item.stores.map((store) => STORE_LABELS[store]).join(", ")}</td>
                  <td>
                    {formatDate(item.effectiveFrom)} - {item.effectiveTo ? formatDate(item.effectiveTo) : "open"}
                  </td>
                  <td>
                    {item.owner} / {item.approver}
                  </td>
                  <td>{item.confidentiality.replaceAll("_", " ")}</td>
                  <td>{item.storageRef}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Evidence Bundles</h2>
          <p className="subtle-text">Submission-scoped bundle assembly for reviewer responses and audit requests.</p>
        </header>

        <ul className="appstores-submission-list">
          {data.evidenceBundles.map((bundle) => (
            <li className="appstores-submission-item" key={bundle.id}>
              <div className="appstores-submission-top">
                <p>{bundle.name}</p>
                <Link className="button button-secondary button-small" href={`/app-stores/evidence-vault?bundle=${bundle.id}#bundle`}>
                  Open bundle
                </Link>
              </div>
              <p className="subtle-text">
                Submission: {bundle.submissionId} | Created {formatDate(bundle.createdAt)} by {bundle.createdBy}
              </p>
              <p>{bundle.notes}</p>
            </li>
          ))}
        </ul>
      </section>

      {selectedBundle ? (
        <section className="appstores-section" id="bundle">
          <header className="appstores-section-header">
            <h2>Bundle Preview: {selectedBundle.name}</h2>
            <span className="pill">MVP export view</span>
          </header>

          <article className="appstores-detail-card">
            <p>
              This bundle would be exported as a structured package with immutable links for submission {selectedBundle.submissionId}.
            </p>
            <ul className="appstores-list-tight">
              {evidenceBundleData.items.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong> ({item.evidenceType.replaceAll("_", " ")})
                  <p className="subtle-text">{item.storageRef}</p>
                </li>
              ))}
            </ul>
            <p className="subtle-text">
              Future enhancement: one-click signed export package (`zip` + manifest + timestamped snapshot hash).
            </p>
          </article>
        </section>
      ) : null}
    </div>
  );
}
