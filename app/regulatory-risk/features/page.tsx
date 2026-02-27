import { getRegulatoryRiskData } from "@/lib/regulatory-risk/data";
import type { FeatureCategory, FeatureCatalogItem } from "@/lib/regulatory-risk/types";

const CATEGORY_ORDER: FeatureCategory[] = ["WALLET", "SERVICE", "GTM"];

function categoryDescription(category: string): string {
  if (category === "WALLET") {
    return "Core wallet capabilities with non-custodial posture controls.";
  }

  if (category === "SERVICE") {
    return "Features that can trigger regulated service-like risk and geo-gating requirements.";
  }

  if (category === "GTM") {
    return "Messaging and distribution choices that affect compliance and partner posture.";
  }

  return "Feature grouping";
}

function groupByCategory(features: FeatureCatalogItem[]): Array<[string, FeatureCatalogItem[]]> {
  const grouped = new Map<string, FeatureCatalogItem[]>();

  features.forEach((feature) => {
    const current = grouped.get(feature.category) || [];
    current.push(feature);
    grouped.set(feature.category, current);
  });

  const orderedEntries: Array<[string, FeatureCatalogItem[]]> = [];

  CATEGORY_ORDER.forEach((category) => {
    if (grouped.has(category)) {
      orderedEntries.push([category, grouped.get(category) || []]);
      grouped.delete(category);
    }
  });

  return [...orderedEntries, ...[...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))];
}

export default async function FeaturesPage() {
  const { bundle } = await getRegulatoryRiskData();
  const groupedFeatures = groupByCategory(bundle.feature_catalog);

  return (
    <section className="regulatory-section">
      <header className="regulatory-section-header">
        <h2>Feature Catalog</h2>
        <p className="subtle-text">Grouped by WALLET, SERVICE, and GTM. SERVICE items are highlighted for service-like risk.</p>
      </header>

      <div className="regulatory-feature-sections">
        {groupedFeatures.map(([category, features]) => (
          <section className="regulatory-feature-group" key={category}>
            <header className="regulatory-feature-group-header">
              <h3>{category}</h3>
              <p className="subtle-text">{categoryDescription(category)}</p>
            </header>

            <div className="regulatory-feature-grid">
              {features.map((feature) => (
                <article
                  className={`regulatory-feature-card ${feature.category === "SERVICE" ? "regulatory-feature-card-service" : ""}`}
                  key={feature.id}
                >
                  <h4>{feature.name}</h4>
                  <p>{feature.notes}</p>

                  <h5>Regulatory triggers</h5>
                  <div className="regulatory-pill-row">
                    {feature.regulatory_triggers.map((trigger) => (
                      <span className="pill" key={trigger}>
                        {trigger}
                      </span>
                    ))}
                  </div>

                  <h5>Recommended controls</h5>
                  <ul className="regulatory-list regulatory-list-tight">
                    {feature.recommended_controls.map((control) => (
                      <li key={control}>{control}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
