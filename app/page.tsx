import Link from "next/link";
import { canAccessDashboard, visibleDashboardsForViewer } from "@/lib/dashboard-catalog";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { SignOutButton } from "./sign-out-button";

export const runtime = "nodejs";

export default async function HomePage() {
  const viewer = await requireAuthenticatedViewer("/");
  const dashboards = visibleDashboardsForViewer(viewer);
  const identityText =
    viewer.mode === "local-bypass"
      ? `Local network bypass active (${viewer.bypassClientIp || "unknown IP"})`
      : `Signed in as ${viewer.email}`;

  return (
    <main className="page dashboard-page">
      <section className="card dashboard-card-shell">
        <header className="feed-header">
          <div>
            <div className="brand-lockup" aria-label="Zodl and Zcash">
              <img className="brand-logo brand-logo-zodl" src="/brand/zodl-logo-black.png" alt="Zodl" width={1673} height={344} />
              <span className="brand-divider" aria-hidden="true" />
              <img className="brand-logo brand-logo-zcash" src="/brand/zcash-logo.svg" alt="Zcash" width={65} height={65} />
            </div>
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
            const restrictedForGuest = !canAccessDashboard(dashboard, viewer);
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
                  {isEnabled ? (
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
