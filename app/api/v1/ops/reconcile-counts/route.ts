import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { requireIngestAuth } from "@/lib/xmonitor/ingest-auth";
import { getReconcileCounts } from "@/lib/xmonitor/repository";

export const runtime = "nodejs";

function defaultSinceIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function parseSinceIso(input: string | null): string | null {
  const value = (input || "").trim();
  if (!value) return defaultSinceIso();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function GET(request: Request) {
  const unauthorized = requireIngestAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  const proxied = await maybeProxyApiRequest(request);
  if (proxied) {
    return proxied;
  }

  const { searchParams } = new URL(request.url);
  const since = parseSinceIso(searchParams.get("since"));
  if (!since) {
    return jsonError("invalid since parameter (expected ISO-8601 timestamp)", 400);
  }

  try {
    ensureDatabaseConfigured();
    const payload = await getReconcileCounts(since);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to compute reconciliation counts", 503);
  }
}
