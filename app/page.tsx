import Link from "next/link";
import type { ReactNode } from "react";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { SignOutButton } from "./sign-out-button";

export const runtime = "nodejs";

type DashboardCard = {
  id: string;
  name: string;
  description: ReactNode;
  href?: string;
  prefetch?: boolean;
  rawDocument?: boolean;
  workspaceOnly?: boolean;
  visible: boolean;
};

// Temporarily hidden cards stay here with visible: false; flip to true to restore them.
const dashboardCatalog: DashboardCard[] = [
  {
    id: "zodl-roadmap",
    name: "Zodl Roadmap",
    description: (
      <>
        <span className="dashboard-card-lead">
          Hold Private. Spend <em>everywhere</em>.
        </span>
        <span>
          Three tracks. Seven stones. Defend revenue against wrapped-ZEC and leveraged outflows. Build the
          spendability and reach users want. Become the privacy infrastructure layer other apps consume.
        </span>
      </>
    ),
    href: "/zodl-roadmap",
    prefetch: false,
    rawDocument: true,
    workspaceOnly: true,
    visible: true,
  },
  {
    id: "x-monitor",
    name: "X Monitor",
    description: "Relevance-filtered X posts with significance signals and analysis details.",
    href: "/x-monitor",
    visible: true,
  },
  {
    id: "cipherpay-test",
    name: "CipherPay Test",
    description: "CipherPay admin config, webhook callback logging, and a minimal checkout simulator.",
    href: "/cipherpay-test",
    visible: false,
  },
  {
    id: "placeholder-1",
    name: "Regulatory Risk by Geography",
    description: "Tiered jurisdiction risk, recommendations, policy posture, and activity feed.",
    href: "/regulatory-risk",
    workspaceOnly: true,
    visible: false,
  },
  {
    id: "app-store-compliance",
    name: "App Store Dashboard",
    description: "Compliance posture, declarations, submissions, reviewer cases, and evidence bundles.",
    href: "/app-stores",
    workspaceOnly: true,
    visible: false,
  },
  {
    id: "placeholder",
    name: "Dashboard Placeholder",
    description: "Reserved for a future dashboard.",
    visible: true,
  },
];

const dashboards = dashboardCatalog.filter((dashboard) => dashboard.visible);

export default async function HomePage() {
  const viewer = await requireAuthenticatedViewer("/");
  const isGuestViewer = viewer.accessLevel === "guest";
  const identityText =
    viewer.mode === "local-bypass"
      ? `Local network bypass active (${viewer.bypassClientIp || "unknown IP"})`
      : `Signed in as ${viewer.email}`;

  return (
    <main className="page dashboard-page">
      <section className="card dashboard-card-shell">
        <header className="feed-header">
          <div>
            <p className="eyebrow">ZODL Team Dashboards</p>
            <h1>Dashboards</h1>
            <p className="subtle-text">{identityText}</p>
          </div>
          <div className="button-row">
            {viewer.canSignOut ? <SignOutButton /> : null}
          </div>
        </header>

        <section className="dashboard-grid" aria-label="Dashboard list">
          {dashboards.map((dashboard) => {
            const restrictedForGuest = isGuestViewer && dashboard.workspaceOnly;
            const isEnabled = Boolean(dashboard.href) && !restrictedForGuest;

            return (
              <article
                aria-label={restrictedForGuest ? `${dashboard.name} (access restricted)` : dashboard.name}
                className={`dashboard-tile${restrictedForGuest ? " dashboard-tile-restricted" : ""}`}
                key={dashboard.id}
              >
                <div className="dashboard-tile-content" aria-hidden={restrictedForGuest ? "true" : undefined}>
                  <h2>{dashboard.name}</h2>
                  <p className="subtle-text">{dashboard.description}</p>
                  {isEnabled && dashboard.rawDocument ? (
                    <a className="button dashboard-open-button" href={dashboard.href!}>
                      Open dashboard
                    </a>
                  ) : isEnabled ? (
                    <Link className="button dashboard-open-button" href={dashboard.href!} prefetch={dashboard.prefetch}>
                      Open dashboard
                    </Link>
                  ) : (
                    <span className="button button-disabled dashboard-open-button" aria-disabled="true">
                      {restrictedForGuest ? "Access restricted" : "Coming soon"}
                    </span>
                  )}
                </div>
                {restrictedForGuest ? (
                  <div className="dashboard-restricted-overlay" aria-hidden="true">
                    <span className="dashboard-restricted-lock">{"\uD83D\uDD12"}</span>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}
