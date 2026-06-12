import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccessControlSnapshot, requireManageAccessPermission } from "@/lib/access-control";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { SignOutButton } from "@/app/sign-out-button";
import { AccessAdminClient } from "./admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AccessAdminPage() {
  const viewer = await requireAuthenticatedViewer("/admin/access");
  try {
    requireManageAccessPermission(viewer);
  } catch {
    redirect("/");
  }

  const snapshotResult = await getAccessControlSnapshot(viewer.email)
    .then((snapshot) => ({ snapshot, error: null }))
    .catch((error) => ({
      snapshot: null,
      error: error instanceof Error ? error.message : "Failed to load access-control data.",
    }));
  const identityText =
    viewer.mode === "local-bypass"
      ? `Local network bypass active (${viewer.bypassClientIp || "unknown IP"})`
      : `Signed in as ${viewer.email}`;

  return (
    <main className="page dashboard-page">
      <section className="card access-admin-shell">
        <header className="feed-header">
          <div>
            <div className="brand-lockup" aria-label="Zodl and Zcash">
              <img className="brand-logo brand-logo-zodl" src="/brand/zodl-logo-black.png" alt="Zodl" width={1673} height={344} />
              <span className="brand-divider" aria-hidden="true" />
              <img className="brand-logo brand-logo-zcash" src="/brand/zcash-logo.svg" alt="Zcash" width={65} height={65} />
            </div>
            <p className="eyebrow">Access Admin</p>
            <h1>Users, Groups & Roles</h1>
            <p className="subtle-text">{identityText}</p>
          </div>
          <div className="button-row">
            <Link className="button button-secondary" href="/">
              All dashboards
            </Link>
            {viewer.canSignOut ? <SignOutButton /> : null}
          </div>
        </header>

        {snapshotResult.snapshot ? (
          <AccessAdminClient initialSnapshot={snapshotResult.snapshot} />
        ) : (
          <section className="access-admin-section">
            <h2>Access-control data unavailable</h2>
            <p className="error-text">{snapshotResult.error}</p>
          </section>
        )}
      </section>
    </main>
  );
}
