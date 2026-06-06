import { PrivateDashboardShell } from "@/app/private-dashboard-shell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ZodlRoadmapPage() {
  return <PrivateDashboardShell dashboardId="zodl-roadmap" />;
}
