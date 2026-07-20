import { canReadDashboard } from "@/lib/access-control";
import { resolveApiRouteViewer } from "@/lib/api-route-viewer";
import { jsonError } from "@/lib/xmonitor/http";

export async function requireXMonitorReadViewer(request: Request): Promise<Response | null> {
  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return jsonError("authentication required", 401);
  }
  if (!canReadDashboard(viewer, "x-monitor")) {
    return jsonError("forbidden", 403);
  }
  return null;
}
