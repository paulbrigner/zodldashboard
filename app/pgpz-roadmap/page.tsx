import { PrivateDashboardShell } from "@/app/private-dashboard-shell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function PgpzRoadmapPage() {
  return <PrivateDashboardShell dashboardId="pgpz-roadmap" />;
}
