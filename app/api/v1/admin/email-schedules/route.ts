import { requireManageAccessPermission } from "@/lib/access-control";
import { resolveApiRouteViewer } from "@/lib/api-route-viewer";
import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { jsonError } from "@/lib/xmonitor/http";
import { buildViewerProxyHeaders } from "@/lib/xmonitor/viewer-proxy";

export const runtime = "nodejs";

async function requireAdminViewer(request: Request) {
  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return { ok: false as const, response: jsonError("authentication required", 401) };
  }

  try {
    requireManageAccessPermission(viewer);
  } catch {
    return { ok: false as const, response: jsonError("access-control admin permission required", 403) };
  }

  return { ok: true as const, viewer };
}

export async function GET(request: Request) {
  const admin = await requireAdminViewer(request);
  if (!admin.ok) return admin.response;

  const backendBase = backendApiBaseUrl();
  if (!backendBase) {
    return jsonError("email schedule inventory requires XMONITOR_BACKEND_API_BASE_URL to be configured", 503);
  }

  const viewerHeaders = buildViewerProxyHeaders(admin.viewer);
  if (!viewerHeaders) {
    return jsonError("XMONITOR_USER_PROXY_SECRET is not configured", 503);
  }

  try {
    const response = await fetch(`${backendBase}/admin/email-schedules`, {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...viewerHeaders,
      },
    });
    const headers = new Headers();
    headers.set("cache-control", response.headers.get("cache-control") || "private, no-store");
    const contentType = response.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "email schedule inventory proxy failed", 503);
  }
}
