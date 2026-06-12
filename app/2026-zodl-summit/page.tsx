import { PrivateDashboardShell } from "@/app/private-dashboard-shell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ZodlSummitPage() {
  return <PrivateDashboardShell dashboardId="2026-zodl-summit" />;
}
