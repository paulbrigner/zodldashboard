import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { jsonError } from "@/lib/xmonitor/http";
import { resolveApiRouteViewer } from "@/lib/api-route-viewer";

function proxySecret(): string | null {
  const value = process.env.XMONITOR_USER_PROXY_SECRET;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function copyProxyResponse(response: Response): Response {
  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const cacheControl = response.headers.get("cache-control");
  if (cacheControl) headers.set("cache-control", cacheControl);
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export async function proxyCipherPayViewerRequest(request: Request, targetPath: string): Promise<Response> {
  const backendBase = backendApiBaseUrl();
  if (!backendBase) {
    return jsonError("CipherPay Test requires XMONITOR_BACKEND_API_BASE_URL to be configured", 503);
  }

  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return jsonError("authentication required", 401);
  }

  const secret = proxySecret();
  if (!secret) {
    return jsonError("XMONITOR_USER_PROXY_SECRET is not configured", 503);
  }

  const contentType = request.headers.get("content-type");
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-xmonitor-viewer-email": viewer.email,
    "x-xmonitor-viewer-auth-mode": viewer.authMode,
    "x-xmonitor-viewer-secret": secret,
  };
  if (contentType) {
    headers["content-type"] = contentType;
  }

  const sourceUrl = new URL(request.url);
  const upstreamUrl = `${backendBase}${targetPath}${sourceUrl.search}`;
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.text();

  try {
    const response = await fetch(upstreamUrl, {
      method,
      cache: "no-store",
      headers,
      body,
    });
    return copyProxyResponse(response);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "CipherPay Test proxy failed", 503);
  }
}
