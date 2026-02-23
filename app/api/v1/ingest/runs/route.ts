import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { requireIngestAuth } from "@/lib/xmonitor/ingest-auth";
import { upsertPipelineRun } from "@/lib/xmonitor/repository";
import { parsePipelineRunUpsert } from "@/lib/xmonitor/validators";

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

  const parsed = parsePipelineRunUpsert(payload);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  try {
    ensureDatabaseConfigured();
    const result = await upsertPipelineRun(parsed.data);
    return jsonOk(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to upsert pipeline run", 503);
  }
}
