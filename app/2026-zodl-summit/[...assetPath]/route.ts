import { findPrivateHtmlDashboard } from "@/lib/dashboard-catalog";
import { privateDashboardAssetResponse } from "@/lib/private-dashboard-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ assetPath: string[] }> }) {
  const { assetPath } = await params;
  return privateDashboardAssetResponse(findPrivateHtmlDashboard("2026-zodl-summit"), assetPath);
}
