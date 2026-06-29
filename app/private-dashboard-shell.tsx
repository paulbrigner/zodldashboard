import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canAccessDashboard, findPrivateHtmlDashboard, navigableDashboards } from "@/lib/dashboard-catalog";
import { getDashboardUpdateSubscriptionState } from "@/lib/dashboard-update-notifications";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { ExecutionTrackerPanel } from "./execution-tracker-panel";
import { PrivateDashboardFrame } from "./private-dashboard-frame";
import { PrivateDashboardGlobalNav, type PrivateDashboardGlobalNavItem } from "./private-dashboard-global-nav";

function identityText(viewer: Awaited<ReturnType<typeof requireAuthenticatedViewer>>): string {
  return viewer.mode === "local-bypass"
    ? `Local network bypass active (${viewer.bypassClientIp || "unknown IP"})`
    : `Signed in as ${viewer.email}`;
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
  const navItems: PrivateDashboardGlobalNavItem[] = [
    { href: "/", label: "All dashboards" },
    ...navDashboards.map((item) => ({
      active: item.id === dashboard.id,
      href: item.href!,
      label: item.navLabel,
      prefetch: item.prefetch,
    })),
  ];
  const updateSubscription = await getDashboardUpdateSubscriptionState(viewer, dashboard.id);

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
        <PrivateDashboardGlobalNav
          authProvider={viewer.authProvider || "next-auth"}
          canSignOut={viewer.canSignOut}
          items={navItems}
          updateNotifications={{
            dashboardId: dashboard.id,
            dashboardName: dashboard.name,
            initialEnabled: updateSubscription.enabled,
            available: updateSubscription.available,
          }}
        />
      </header>
      <PrivateDashboardFrame
        className="private-dashboard-frame"
        contentHref={dashboard.contentHref}
        title={`${dashboard.name} content`}
      />
      {dashboard.supportsExecutionTracker ? (
        <ExecutionTrackerPanel dashboardId={dashboard.id} dashboardName={dashboard.name} />
      ) : null}
    </main>
  );
}
