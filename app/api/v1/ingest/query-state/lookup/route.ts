import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { requireIngestAuth } from "@/lib/xmonitor/ingest-auth";
import { getIngestQueryCheckpoints } from "@/lib/xmonitor/repository";
import { parseIngestQueryCheckpointLookup } from "@/lib/xmonitor/validators";

export const runtime = "nodejs";

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

  const parsed = parseIngestQueryCheckpointLookup(payload);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  try {
    ensureDatabaseConfigured();
    const items = await getIngestQueryCheckpoints(parsed.query_keys);
    return jsonOk({ items });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to lookup query checkpoints", 503);
  }
}
