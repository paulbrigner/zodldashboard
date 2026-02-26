import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { requireIngestAuth } from "@/lib/xmonitor/ingest-auth";
import { purgePostsByAuthorHandle } from "@/lib/xmonitor/repository";

export const runtime = "nodejs";

function parseHandle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(request: Request) {
  const unauthorized = requireIngestAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  const proxied = await maybeProxyApiRequest(request);
  if (proxied) {
    return proxied;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const data = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
  const handle = parseHandle(data?.author_handle ?? data?.handle);
  if (!handle) {
    return jsonError("author_handle is required", 400);
  }

  try {
    ensureDatabaseConfigured();
    const result = await purgePostsByAuthorHandle(handle);
    return jsonOk({
      author_handle: result.author_handle,
      deleted: result.deleted,
      purged_at: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to purge posts", 503);
  }
}
