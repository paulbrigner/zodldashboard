import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadDashboard } from "@/lib/access-control";
import { getDashboardUpdateSubscriptionState } from "@/lib/dashboard-update-notifications";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { formatDateTime } from "@/lib/app-stores/insights";
import { getAppStoresDataset } from "@/lib/app-stores/data";
import { DashboardUpdateSubscriptionToggle } from "../dashboard-update-subscription-toggle";
import { AppStoresNavLinks } from "./nav-links";
import { SignOutButton } from "../sign-out-button";

export const runtime = "nodejs";

export default async function AppStoresLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const viewer = await requireAuthenticatedViewer("/app-stores");
  if (!canReadDashboard(viewer, "app-store-compliance")) {
    redirect("/");
  }

  const data = getAppStoresDataset();
  const updateSubscription = await getDashboardUpdateSubscriptionState(viewer, "app-store-compliance");
  const identityText =
    viewer.mode === "local-bypass"
      ? `Local network bypass active (${viewer.bypassClientIp || "unknown IP"})`
      : `Signed in as ${viewer.email}`;

  return (
    <main className="page dashboard-page">
      <section className="card appstores-shell">
        <header className="feed-header">
          <div>
            <p className="eyebrow">App Store Compliance Dashboard</p>
            <h1>App Store Compliance &amp; Submissions</h1>
            <p className="subtle-text">{identityText}</p>
            <p className="subtle-text appstores-source-text">
              Alpha dataset refreshed {formatDateTime(data.generatedAt)}. Manual + demo data is shown for MVP flow validation.
            </p>
          </div>
          <div className="button-row">
            <DashboardUpdateSubscriptionToggle
              dashboardId="app-store-compliance"
              dashboardName="App Store Dashboard"
              initialEnabled={updateSubscription.enabled}
              available={updateSubscription.available}
            />
            <Link className="button button-secondary" href="/">
              All dashboards
            </Link>
            {viewer.canSignOut ? <SignOutButton authProvider={viewer.authProvider || "next-auth"} /> : null}
          </div>
        </header>

        <AppStoresNavLinks />

        <div className="appstores-content">{children}</div>
      </section>
    </main>
  );
}
