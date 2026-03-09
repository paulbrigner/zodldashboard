import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { requireIngestAuth } from "@/lib/xmonitor/ingest-auth";
import { claimPostsForClassification } from "@/lib/xmonitor/repository";
import { parseSignificanceClaimRequest } from "@/lib/xmonitor/validators";

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

  let payload: unknown = {};

  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const parsed = parseSignificanceClaimRequest(payload);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  try {
    ensureDatabaseConfigured();
    return jsonOk(await claimPostsForClassification(parsed.data));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to claim posts for classification", 503);
  }
}
