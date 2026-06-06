import { findPrivateHtmlDashboard } from "@/lib/dashboard-catalog";
import { privateDashboardAssetResponse } from "@/lib/private-dashboard-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ assetPath: string[] }> }) {
  const { assetPath } = await context.params;
  return privateDashboardAssetResponse(findPrivateHtmlDashboard("arktouros"), assetPath);
}
