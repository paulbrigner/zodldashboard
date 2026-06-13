import {
  dashboardUpdateNotificationStatus,
  publishDashboardUpdate,
  type DashboardUpdatePublishPayload,
} from "@/lib/dashboard-update-notifications";
import { requireManageAccessPermission } from "@/lib/access-control";
import { resolveApiRouteViewer } from "@/lib/api-route-viewer";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";

export const runtime = "nodejs";

function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export async function POST(request: Request) {
  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return jsonError("authentication required", 401);
  }
  try {
    requireManageAccessPermission(viewer);
  } catch {
    return jsonError("access-control admin permission required", 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const publishPayload: DashboardUpdatePublishPayload = {
    dashboardId: textValue(body.dashboard_id || body.dashboardId) || "",
    title: textValue(body.title),
    summary: textValue(body.summary),
    url: textValue(body.url),
    source: textValue(body.source) as DashboardUpdatePublishPayload["source"],
    sourceRef: textValue(body.source_ref || body.sourceRef),
  };

  try {
    const result = await publishDashboardUpdate(viewer, publishPayload);
    return jsonOk(result, 201);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "failed to publish dashboard update",
      dashboardUpdateNotificationStatus(error, 503)
    );
  }
}
