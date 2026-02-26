import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { ComposeExecutionError, composeEnabled, executeComposeQuery } from "@/lib/xmonitor/compose";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { semanticEnabled } from "@/lib/xmonitor/semantic";
import { parseComposeQueryRequest } from "@/lib/xmonitor/validators";

export const runtime = "nodejs";

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
    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    const result = await executeComposeQuery(backendBase, parsed.data, requestId);
    return jsonOk(result);
  } catch (error) {
    if (error instanceof ComposeExecutionError) {
      return jsonError(error.message, error.status);
    }
    return jsonError(error instanceof Error ? error.message : "failed to execute compose query", 503);
  }
}
