import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  canAccessDashboard,
  findPrivateHtmlDashboard,
  navigableDashboards,
  type DashboardCatalogItem,
  type PrivateHtmlDashboard,
} from "@/lib/dashboard-catalog";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { SignOutButton } from "./sign-out-button";

function identityText(viewer: Awaited<ReturnType<typeof requireAuthenticatedViewer>>): string {
  return viewer.mode === "local-bypass"
    ? `Local network bypass active (${viewer.bypassClientIp || "unknown IP"})`
    : `Signed in as ${viewer.email}`;
}

function isActiveDashboard(dashboard: DashboardCatalogItem, activeDashboard: PrivateHtmlDashboard): boolean {
  return dashboard.id === activeDashboard.id;
}

export async function PrivateDashboardShell({ dashboardId }: { dashboardId: string }) {
  const dashboard = findPrivateHtmlDashboard(dashboardId);
  const viewer = await requireAuthenticatedViewer(dashboard.href || "/");

  if (!dashboard.canAccess(viewer)) {
    const requestHeaders = await headers();
    await dashboard.recordAccess({
      viewer,
      outcome: "denied_guest",
      statusCode: 302,
      headers: requestHeaders,
    });
    redirect("/");
  }

  const navDashboards = navigableDashboards().filter((item) => canAccessDashboard(item, viewer));

  return (
    <main className="private-dashboard-page">
      <header className="private-dashboard-nav">
        <div className="private-dashboard-title-block">
          <div className="brand-lockup brand-lockup-compact" aria-label="Zodl and Zcash">
            <img className="brand-logo brand-logo-zodl" src="/brand/zodl-logo-black.png" alt="Zodl" width={1673} height={344} />
            <span className="brand-divider" aria-hidden="true" />
            <img className="brand-logo brand-logo-zcash" src="/brand/zcash-logo.svg" alt="Zcash" width={65} height={65} />
          </div>
          <p className="eyebrow">Private dashboard</p>
          <h1>{dashboard.name}</h1>
          <p className="private-dashboard-identity">{identityText(viewer)}</p>
        </div>
        <div className="private-dashboard-actions">
          <nav className="private-dashboard-links" aria-label="Dashboard navigation">
            <Link className="private-dashboard-link" href="/">
              All dashboards
            </Link>
            {navDashboards.map((item) => {
              const active = isActiveDashboard(item, dashboard);
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`private-dashboard-link${active ? " private-dashboard-link-active" : ""}`}
                  href={item.href!}
                  key={item.id}
                  prefetch={item.prefetch}
                >
                  {item.navLabel}
                </Link>
              );
            })}
          </nav>
          {viewer.canSignOut ? <SignOutButton /> : null}
        </div>
      </header>
      <iframe
        className="private-dashboard-frame"
        src={dashboard.contentHref}
        title={`${dashboard.name} content`}
      />
    </main>
  );
}
