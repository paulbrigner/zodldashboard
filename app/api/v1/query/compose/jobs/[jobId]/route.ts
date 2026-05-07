import { resolveApiRouteViewer } from "@/lib/api-route-viewer";
import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { composeEnabled } from "@/lib/xmonitor/compose";
import { jsonError } from "@/lib/xmonitor/http";
import { buildViewerProxyHeaders } from "@/lib/xmonitor/viewer-proxy";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return jsonError("authentication required", 401);
  }

  const viewerHeaders = buildViewerProxyHeaders(viewer);
  if (!viewerHeaders) {
    return jsonError("XMONITOR_USER_PROXY_SECRET is not configured", 503);
  }

  if (!composeEnabled()) {
    return jsonError("compose query is disabled", 503);
  }

  const backendBase = backendApiBaseUrl();
  if (!backendBase) {
    return jsonError("compose query requires XMONITOR_BACKEND_API_BASE_URL to be configured", 503);
  }

  const { jobId } = await context.params;
  if (!jobId) {
    return jsonError("jobId is required", 400);
  }

  try {
    const requestHeaders: Record<string, string> = {
      accept: "application/json",
      ...viewerHeaders,
    };

    const response = await fetch(`${backendBase}/query/compose/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      cache: "no-store",
      headers: requestHeaders,
    });

    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const cacheControl = response.headers.get("cache-control");
    if (cacheControl) headers.set("cache-control", cacheControl);

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to read compose job", 503);
  }
}
