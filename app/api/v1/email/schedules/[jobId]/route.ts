import { resolveApiRouteViewer } from "@/lib/api-route-viewer";
import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { jsonError } from "@/lib/xmonitor/http";
import { buildViewerProxyHeaders } from "@/lib/xmonitor/viewer-proxy";

export const runtime = "nodejs";

async function proxyRequest(
  request: Request,
  jobId: string,
  method: "PATCH" | "DELETE"
): Promise<Response> {
  const backendBase = backendApiBaseUrl();
  if (!backendBase) {
    return jsonError("email schedules require XMONITOR_BACKEND_API_BASE_URL to be configured", 503);
  }

  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return jsonError("authentication required", 401);
  }

  const viewerHeaders = buildViewerProxyHeaders(viewer);
  if (!viewerHeaders) {
    return jsonError("XMONITOR_USER_PROXY_SECRET is not configured", 503);
  }

  const init: RequestInit = {
    method,
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...viewerHeaders,
    },
  };
  if (method === "PATCH") {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = await request.text();
  }

  try {
    const response = await fetch(`${backendBase}/email/schedules/${encodeURIComponent(jobId)}`, init);
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
    return jsonError(error instanceof Error ? error.message : "email schedules proxy failed", 503);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  if (!jobId) return jsonError("jobId is required", 400);
  return proxyRequest(request, jobId, "PATCH");
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  if (!jobId) return jsonError("jobId is required", 400);
  return proxyRequest(request, jobId, "DELETE");
}
