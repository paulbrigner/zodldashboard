import { getRegulatoryRiskData } from "@/lib/regulatory-risk/data";

export default async function PolicyPage() {
  const { bundle } = await getRegulatoryRiskData();

  const requiredGuardrails = bundle.guardrails.filter((guardrail) => guardrail.status === "required");
  const recommendedGuardrails = bundle.guardrails.filter((guardrail) => guardrail.status !== "required");

  return (
    <section className="regulatory-section">
      <header className="regulatory-section-header">
        <h2>Policy and Guardrails</h2>
        <p className="subtle-text">Current operating posture, permission matrix, and required controls.</p>
      </header>

      <section className="regulatory-subsection">
        <h3>Operating modes</h3>
        <div className="regulatory-card-grid">
          {bundle.operating_policy.modes.map((mode) => (
            <article className="regulatory-card" key={mode.id}>
              <p className="eyebrow">{mode.id}</p>
              <h4>{mode.label}</h4>
              <p>{mode.description}</p>
              <p className="subtle-text">Applies to tiers: {mode.applies_to.join(", ")}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="regulatory-subsection">
        <h3>Guardrails (required)</h3>
        <ul className="regulatory-recommendation-list">
          {requiredGuardrails.map((guardrail) => (
            <li className="regulatory-recommendation-item" key={guardrail.id}>
              <div className="regulatory-recommendation-header">
                <h4>{guardrail.title}</h4>
                <span className="pill">Required</span>
              </div>
              <p>{guardrail.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="regulatory-subsection">
        <h3>Guardrails (recommended)</h3>
        <ul className="regulatory-recommendation-list">
          {recommendedGuardrails.map((guardrail) => (
            <li className="regulatory-recommendation-item" key={guardrail.id}>
              <div className="regulatory-recommendation-header">
                <h4>{guardrail.title}</h4>
                <span className="pill">Recommended</span>
              </div>
              <p>{guardrail.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="regulatory-subsection">
        <h3>Permission matrix</h3>
        <div className="regulatory-table-wrap">
          <table className="regulatory-table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>RED</th>
                <th>AMBER</th>
                <th>GREEN</th>
              </tr>
            </thead>
            <tbody>
              {bundle.operating_policy.permission_matrix.map((row) => (
                <tr key={row.scenario}>
                  <td>{row.scenario}</td>
                  <td>{row.RED}</td>
                  <td>{row.AMBER}</td>
                  <td>{row.GREEN}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="regulatory-subsection">
        <h3>Implementation controls</h3>
        <ul className="regulatory-list">
          {bundle.operating_policy.implementation_controls.map((control) => (
            <li key={control}>{control}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}
