import {
  dashboardUpdateNotificationStatus,
  getDashboardUpdateSubscriptionState,
  setDashboardUpdateSubscriptionState,
} from "@/lib/dashboard-update-notifications";
import { resolveApiRouteViewer } from "@/lib/api-route-viewer";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";

export const runtime = "nodejs";

function dashboardIdFrom(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function GET(request: Request) {
  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return jsonError("authentication required", 401);
  }

  const dashboardId = dashboardIdFrom(new URL(request.url).searchParams.get("dashboard_id"));
  if (!dashboardId) {
    return jsonError("dashboard_id is required", 400);
  }

  try {
    const subscription = await getDashboardUpdateSubscriptionState(viewer, dashboardId);
    return jsonOk({ subscription });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "failed to load dashboard update subscription",
      dashboardUpdateNotificationStatus(error, 503)
    );
  }
}

export async function POST(request: Request) {
  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return jsonError("authentication required", 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const dashboardId = dashboardIdFrom(body.dashboard_id || body.dashboardId);
  if (!dashboardId) {
    return jsonError("dashboard_id is required", 400);
  }

  try {
    const subscription = await setDashboardUpdateSubscriptionState(viewer, dashboardId, body.enabled === true);
    return jsonOk({ subscription });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "failed to save dashboard update subscription",
      dashboardUpdateNotificationStatus(error, 503)
    );
  }
}
