import { PrivateDashboardShell } from "@/app/private-dashboard-shell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function PlacehodlrPage() {
  return <PrivateDashboardShell dashboardId="placehodlr" />;
}
