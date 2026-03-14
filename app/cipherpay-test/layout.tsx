import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { SignOutButton } from "../sign-out-button";
import { CipherPayTestNavLinks } from "./nav-links";

export const runtime = "nodejs";

export default async function CipherPayTestLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const viewer = await requireAuthenticatedViewer("/cipherpay-test");
  if (viewer.accessLevel === "guest") {
    redirect("/");
  }

  const identityText =
    viewer.mode === "local-bypass"
      ? `Local network bypass active (${viewer.bypassClientIp || "unknown IP"})`
      : `Signed in as ${viewer.email}`;

  return (
    <main className="page dashboard-page">
      <section className="card cipherpay-shell">
        <header className="feed-header">
          <div>
            <p className="eyebrow">CipherPay Test</p>
            <h1>CipherPay Test Dashboard</h1>
            <p className="subtle-text">{identityText}</p>
            <p className="subtle-text cipherpay-source-text">
              Testnet-first admin, webhook, and checkout harness backed by the same AWS-hosted API stack as the X dashboard.
            </p>
          </div>
          <div className="button-row">
            <Link className="button button-secondary" href="/">
              All dashboards
            </Link>
            {viewer.canSignOut ? <SignOutButton /> : null}
          </div>
        </header>

        <CipherPayTestNavLinks />

        <div className="cipherpay-content">{children}</div>
      </section>
    </main>
  );
}
