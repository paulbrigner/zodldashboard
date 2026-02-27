import Link from "next/link";
import { getRegulatoryRiskData } from "@/lib/regulatory-risk/data";
import { formatIsoDate } from "@/lib/regulatory-risk/insights";
import { asString, withSearchParams } from "@/lib/regulatory-risk/utils";

type JurisdictionsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function normalizeTier(value: string | undefined): string {
  return (value || "").toUpperCase();
}

export default async function JurisdictionsPage({ searchParams }: JurisdictionsPageProps) {
  const { bundle } = await getRegulatoryRiskData();
  const params = (await searchParams) || {};

  const tierFilter = normalizeTier(asString(params.tier));
  const regionFilter = (asString(params.region) || "").trim();
  const queryText = (asString(params.q) || "").trim();
  const query = queryText.toLowerCase();
  const selectedId = asString(params.selected);

  const regions = [...new Set(bundle.jurisdictions.map((jurisdiction) => jurisdiction.region))].sort();

  const filteredJurisdictions = bundle.jurisdictions
    .filter((jurisdiction) => {
      if (tierFilter && jurisdiction.tier !== tierFilter) {
        return false;
      }

      if (regionFilter && jurisdiction.region !== regionFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchableText = [jurisdiction.name, jurisdiction.region, jurisdiction.risk_summary].join(" ").toLowerCase();
      return searchableText.includes(query);
    })
    .sort((a, b) => {
      if (a.tier === b.tier) {
        return a.name.localeCompare(b.name);
      }
      return a.tier.localeCompare(b.tier);
    });

  const selectedJurisdiction =
    bundle.jurisdictions.find((jurisdiction) => jurisdiction.id === selectedId) || filteredJurisdictions[0] || null;

  const baseParams = {
    tier: tierFilter || undefined,
    region: regionFilter || undefined,
    q: queryText || undefined,
  };

  return (
    <section className="regulatory-section">
      <header className="regulatory-section-header">
        <h2>Jurisdictions</h2>
        <p className="subtle-text">Filter by tier, region, and search terms. Select a row to inspect details.</p>
      </header>

      <form action="/regulatory-risk/jurisdictions" className="filter-grid regulatory-filters" method="get">
        <label>
          <span>Tier</span>
          <select defaultValue={tierFilter} name="tier">
            <option value="">All tiers</option>
            {Object.keys(bundle.tiers).map((tierCode) => (
              <option key={tierCode} value={tierCode}>
                {tierCode}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Region</span>
          <select defaultValue={regionFilter} name="region">
            <option value="">All regions</option>
            {regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Search</span>
          <input defaultValue={queryText} name="q" placeholder="Name, region, summary" type="text" />
        </label>

        <div className="filter-actions">
          <button className="button" type="submit">
            Apply filters
          </button>
          <Link className="button button-secondary" href="/regulatory-risk/jurisdictions">
            Reset
          </Link>
        </div>
      </form>

      <div className="regulatory-two-column">
        <div className="regulatory-table-wrap">
          <table className="regulatory-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Tier</th>
                <th>Region</th>
                <th>Primary sources</th>
                <th>Confidence</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredJurisdictions.map((jurisdiction) => (
                <tr key={jurisdiction.id}>
                  <td>{jurisdiction.name}</td>
                  <td>{jurisdiction.tier}</td>
                  <td>{jurisdiction.region}</td>
                  <td>{jurisdiction.primary_sources.length === 0 ? "Missing" : "Provided"}</td>
                  <td>{jurisdiction.confidence}/5</td>
                  <td>
                    <Link
                      className="button button-small button-secondary"
                      href={withSearchParams("/regulatory-risk/jurisdictions", {
                        ...baseParams,
                        selected: jurisdiction.id,
                      })}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredJurisdictions.length === 0 ? <p className="subtle-text">No jurisdictions match current filters.</p> : null}
        </div>

        <aside className="regulatory-detail-card">
          {selectedJurisdiction ? (
            <>
              <p className="eyebrow">Selected jurisdiction</p>
              <h3>{selectedJurisdiction.name}</h3>
              <p className="subtle-text">
                {selectedJurisdiction.region} · {selectedJurisdiction.tier} tier · Confidence {selectedJurisdiction.confidence}/5
              </p>

              <p>{selectedJurisdiction.risk_summary}</p>

              <h4>Team guidance</h4>
              <ul className="regulatory-list regulatory-list-tight">
                {selectedJurisdiction.team_guidance.map((guidance) => (
                  <li key={guidance}>{guidance}</li>
                ))}
              </ul>

              <h4>Scope</h4>
              <div className="regulatory-pill-row">
                {selectedJurisdiction.scope.map((scopeItem) => (
                  <span className="pill" key={scopeItem}>
                    {scopeItem}
                  </span>
                ))}
              </div>

              <h4>Primary sources</h4>
              {selectedJurisdiction.primary_sources.length === 0 ? (
                <p className="error-text regulatory-inline-alert">Missing primary sources. Add citations and verification links.</p>
              ) : (
                <ul className="regulatory-list regulatory-list-tight">
                  {selectedJurisdiction.primary_sources.map((source) => (
                    <li key={source}>{source}</li>
                  ))}
                </ul>
              )}

              <p className="subtle-text">
                Last verified {formatIsoDate(selectedJurisdiction.last_verified_on)} · Next due{" "}
                {formatIsoDate(selectedJurisdiction.next_verification_due_on)}
              </p>
            </>
          ) : (
            <p className="subtle-text">Select a jurisdiction to view details.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
