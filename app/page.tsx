import Link from "next/link";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { SignOutButton } from "./sign-out-button";

export const runtime = "nodejs";

type DashboardCard = {
  id: string;
  name: string;
  description: string;
  href?: string;
};

const dashboards: DashboardCard[] = [
  {
    id: "x-monitor",
    name: "X Monitor",
    description: "Relevance-filtered X posts with significance signals and analysis details.",
    href: "/x-monitor",
  },
  {
    id: "placeholder-1",
    name: "Regulatory Risk by Geography",
    description: "Tiered jurisdiction risk, recommendations, policy posture, and activity feed.",
    href: "/regulatory-risk",
  },
  {
    id: "placeholder-2",
    name: "Dashboard Placeholder 2",
    description: "Reserved for a future dashboard.",
  },
  {
    id: "placeholder-3",
    name: "Dashboard Placeholder 3",
    description: "Reserved for a future dashboard.",
  },
];

export default async function HomePage() {
  const viewer = await requireAuthenticatedViewer("/");
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
          {dashboards.map((dashboard) => (
            <article className="dashboard-tile" key={dashboard.id}>
              <h2>{dashboard.name}</h2>
              <p className="subtle-text">{dashboard.description}</p>
              {dashboard.href ? (
                <Link className="button" href={dashboard.href}>
                  Open dashboard
                </Link>
              ) : (
                <span className="button button-disabled" aria-disabled="true">
                  Coming soon
                </span>
              )}
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
