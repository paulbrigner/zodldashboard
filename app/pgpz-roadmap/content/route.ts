import { findPrivateHtmlDashboard } from "@/lib/dashboard-catalog";
import { privateDashboardContentResponse } from "@/lib/private-dashboard-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return privateDashboardContentResponse(findPrivateHtmlDashboard("pgpz-roadmap"));
}
