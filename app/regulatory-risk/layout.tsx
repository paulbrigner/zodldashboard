import Link from "next/link";
import { SignOutButton } from "../sign-out-button";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { getRegulatoryRiskData } from "@/lib/regulatory-risk/data";
import { formatIsoDate } from "@/lib/regulatory-risk/insights";
import { RegulatoryRiskNavLinks } from "./nav-links";

export const runtime = "nodejs";

export default async function RegulatoryRiskLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const viewer = await requireAuthenticatedViewer("/regulatory-risk");
  const { bundle, source, dataUrl, warning } = await getRegulatoryRiskData();

  const identityText =
    viewer.mode === "local-bypass"
      ? `Local network bypass active (${viewer.bypassClientIp || "unknown IP"})`
      : `Signed in as ${viewer.email}`;

  const sourceText =
    source === "remote" ? `Live data source: ${dataUrl}` : `Bundled data: ${formatIsoDate(bundle.meta.generated_on)}`;

  return (
    <main className="page dashboard-page">
      <section className="card regulatory-shell">
        <header className="feed-header">
          <div>
            <p className="eyebrow">Regulatory Risk Dashboard</p>
            <h1>Regulatory Risk by Geography</h1>
            <p className="subtle-text">{identityText}</p>
            <p className="subtle-text regulatory-source-text">{sourceText}</p>
          </div>
          <div className="button-row">
            <Link className="button button-secondary" href="/">
              All dashboards
            </Link>
            {viewer.canSignOut ? <SignOutButton /> : null}
          </div>
        </header>

        <RegulatoryRiskNavLinks />

        {warning ? <p className="error-text regulatory-inline-alert">{warning}</p> : null}

        {children}
      </section>
    </main>
  );
}
