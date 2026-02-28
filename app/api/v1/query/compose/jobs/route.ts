import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { composeEnabled } from "@/lib/xmonitor/compose";
import { jsonError } from "@/lib/xmonitor/http";
import { semanticEnabled } from "@/lib/xmonitor/semantic";
import { parseComposeQueryRequest } from "@/lib/xmonitor/validators";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!composeEnabled()) {
    return jsonError("compose query is disabled", 503);
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

  const parsed = parseComposeQueryRequest(payload);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  const backendBase = backendApiBaseUrl();
  if (!backendBase) {
    return jsonError("compose query requires XMONITOR_BACKEND_API_BASE_URL to be configured", 503);
  }

  try {
    const response = await fetch(`${backendBase}/query/compose/jobs`, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(parsed.data),
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
    return jsonError(error instanceof Error ? error.message : "failed to enqueue compose job", 503);
  }
}
