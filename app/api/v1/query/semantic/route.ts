import { resolveApiRouteViewer } from "@/lib/api-route-viewer";
import { canReadDashboard } from "@/lib/access-control";
import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { jsonError } from "@/lib/xmonitor/http";
import { createQueryEmbedding, semanticEnabled } from "@/lib/xmonitor/semantic";
import { parseSemanticQueryRequest } from "@/lib/xmonitor/validators";
import { buildViewerProxyHeaders } from "@/lib/xmonitor/viewer-proxy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return jsonError("authentication required", 401);
  }
  if (!canReadDashboard(viewer, "x-monitor")) {
    return jsonError("forbidden", 403);
  }

  const viewerHeaders = buildViewerProxyHeaders(viewer);
  if (!viewerHeaders) {
    return jsonError("XMONITOR_USER_PROXY_SECRET is not configured", 503);
  }

  if (!semanticEnabled()) {
    return jsonError("semantic query is disabled", 503);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const parsed = parseSemanticQueryRequest(payload);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  const backendBase = backendApiBaseUrl();
  if (!backendBase) {
    return jsonError("semantic query requires XMONITOR_BACKEND_API_BASE_URL to be configured", 503);
  }

  try {
    const vector = await createQueryEmbedding(parsed.data.query_text);
    const upstream = await fetch(`${backendBase}/query/semantic`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...viewerHeaders,
      },
      body: JSON.stringify({
        query_text: parsed.data.query_text,
        query_vector: vector,
        since: parsed.data.since,
        until: parsed.data.until,
        tiers: parsed.data.tiers,
        handle: parsed.data.handle,
        significant: parsed.data.significant,
        limit: parsed.data.limit,
      }),
    });

    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const cacheControl = upstream.headers.get("cache-control");
    if (cacheControl) headers.set("cache-control", cacheControl);

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to execute semantic query", 503);
  }
}
