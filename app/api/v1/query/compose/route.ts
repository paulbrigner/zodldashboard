import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { jsonError } from "@/lib/xmonitor/http";
import { createQueryEmbedding, semanticEnabled } from "@/lib/xmonitor/semantic";
import { parseComposeQueryRequest } from "@/lib/xmonitor/validators";

export const runtime = "nodejs";

function composeEnabled(): boolean {
  const value = process.env.XMONITOR_COMPOSE_ENABLED;
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return true;
}

export async function POST(request: Request) {
  if (!composeEnabled()) {
    return jsonError("compose query is disabled", 503);
  }

  // Compose depends on semantic retrieval embeddings.
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
    const vector = await createQueryEmbedding(parsed.data.task_text);
    const upstream = await fetch(`${backendBase}/query/compose`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        task_text: parsed.data.task_text,
        query_vector: vector,
        since: parsed.data.since,
        until: parsed.data.until,
        tier: parsed.data.tier,
        handle: parsed.data.handle,
        significant: parsed.data.significant,
        retrieval_limit: parsed.data.retrieval_limit,
        context_limit: parsed.data.context_limit,
        answer_style: parsed.data.answer_style,
        draft_format: parsed.data.draft_format,
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
    return jsonError(error instanceof Error ? error.message : "failed to execute compose query", 503);
  }
}
