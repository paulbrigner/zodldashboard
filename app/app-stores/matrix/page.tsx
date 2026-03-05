import {
  FEATURE_AVAILABILITY_LABELS,
  getAppStoresDataset,
} from "@/lib/app-stores/data";
import { buildStatementPack } from "@/lib/app-stores/insights";

function asYesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function statusClass(status: string): string {
  if (status === "allowed") return "pill pill-status-good";
  if (status === "limited" || status === "under_review") return "pill pill-status-warn";
  if (status === "disabled") return "pill pill-status-bad";
  return "pill";
}

export default async function AppStoresFeatureMatrixPage() {
  const data = getAppStoresDataset();
  const statements = buildStatementPack(data.featureMatrix);

  return (
    <div className="appstores-page-body">
      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Feature-to-Claim Matrix</h2>
          <p className="subtle-text">
            Controlled mapping between product behavior, store-facing claims, and compliance hooks.
          </p>
        </header>

        <div className="appstores-table-wrap">
          <table className="appstores-table appstores-table-dense">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Crypto features</th>
                <th>Custody model</th>
                <th>Swaps</th>
                <th>Fees</th>
                <th>Fiat on/off-ramp</th>
                <th>Staking/yield</th>
                <th>KYC</th>
                <th>Geofencing/sanctions</th>
                <th>Advice avoidance language</th>
              </tr>
            </thead>
            <tbody>
              {data.featureMatrix.map((row) => (
                <tr key={row.featureId}>
                  <td>
                    <strong>{row.featureName}</strong>
                    <p className="subtle-text">{row.description}</p>
                  </td>
                  <td>{asYesNo(row.providesCryptoFeatures)}</td>
                  <td>{row.custodyModel.replace("_", "-")}</td>
                  <td>{row.swapsMode.replace("_", " ")}</td>
                  <td>{row.feesModel}</td>
                  <td>{asYesNo(row.fiatOnOffRamp)}</td>
                  <td>{asYesNo(row.stakingYield)}</td>
                  <td>{asYesNo(row.kycCollection)}</td>
                  <td>{row.geofencingSanctionsControls}</td>
                  <td>{row.financialAdviceAvoidanceLanguage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Jurisdictional Availability</h2>
          <p className="subtle-text">Allowed/disabled/limited posture by feature and region.</p>
        </header>

        <div className="appstores-table-wrap">
          <table className="appstores-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Region</th>
                <th>Availability</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {data.jurisdictionPosture.map((row) => {
                const feature = data.featureMatrix.find((featureItem) => featureItem.featureId === row.featureId);
                return (
                  <tr key={`${row.featureId}-${row.regionCode}`}>
                    <td>{feature?.featureName || row.featureId}</td>
                    <td>{row.regionLabel}</td>
                    <td>
                      <span className={statusClass(row.availability)}>{FEATURE_AVAILABILITY_LABELS[row.availability]}</span>
                    </td>
                    <td>{row.rationale}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Store-facing Statement Pack (MVP Preview)</h2>
          <p className="subtle-text">Reusable copy blocks generated from the controlled matrix to reduce declaration drift.</p>
        </header>

        <ul className="appstores-list-tight">
          {statements.map((statement) => (
            <li key={statement}>{statement}</li>
          ))}
        </ul>
      </section>

      <section className="appstores-section">
        <header className="appstores-section-header">
          <h2>Feature Change Diff Report</h2>
          <p className="subtle-text">Change review queue highlighting declaration-impacting edits.</p>
        </header>

        <div className="appstores-table-wrap">
          <table className="appstores-table">
            <thead>
              <tr>
                <th>Release</th>
                <th>Feature</th>
                <th>Summary</th>
                <th>Risk flags</th>
                <th>Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {data.featureChanges.map((change) => (
                <tr key={change.id}>
                  <td>{change.releaseVersion}</td>
                  <td>{change.featureName}</td>
                  <td>{change.summary}</td>
                  <td>{change.riskFlags.length > 0 ? change.riskFlags.join(", ") : "None"}</td>
                  <td>
                    <span className={change.reviewed ? "pill pill-status-good" : "pill pill-status-warn"}>
                      {change.reviewed ? "Reviewed" : "Needs review"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
