const DEFAULT_PROXY_TIMEOUT_MS = 15000;

function trimBaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

function mapInternalApiPath(pathname: string): string {
  if (pathname === "/api/v1") return "/v1";
  if (pathname.startsWith("/api/v1/")) {
    return `/v1/${pathname.slice("/api/v1/".length)}`;
  }
  return pathname;
}

function proxyTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.XMONITOR_API_PROXY_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PROXY_TIMEOUT_MS;
}

export function backendApiBaseUrl(): string | null {
  return trimBaseUrl(process.env.XMONITOR_BACKEND_API_BASE_URL);
}

export function readApiBaseUrl(): string | null {
  return trimBaseUrl(process.env.XMONITOR_READ_API_BASE_URL) || backendApiBaseUrl();
}

export async function maybeProxyApiRequest(request: Request): Promise<Response | null> {
  const baseUrl = backendApiBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const sourceUrl = new URL(request.url);
  const targetPath = mapInternalApiPath(sourceUrl.pathname);
  const targetUrl = new URL(`${targetPath}${sourceUrl.search}`, `${baseUrl}/`);

  const requestHeaders = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) requestHeaders.set("content-type", contentType);
  const accept = request.headers.get("accept");
  if (accept) requestHeaders.set("accept", accept);
  const authorization = request.headers.get("authorization");
  if (authorization) requestHeaders.set("authorization", authorization);
  const apiKey = request.headers.get("x-api-key");
  if (apiKey) requestHeaders.set("x-api-key", apiKey);

  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers: requestHeaders,
    redirect: "manual",
    cache: "no-store",
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), proxyTimeoutMs());
  init.signal = controller.signal;

  try {
    const upstream = await fetch(targetUrl, init);
    const responseHeaders = new Headers();
    const responseContentType = upstream.headers.get("content-type");
    if (responseContentType) responseHeaders.set("content-type", responseContentType);
    const responseCacheControl = upstream.headers.get("cache-control");
    if (responseCacheControl) responseHeaders.set("cache-control", responseCacheControl);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
