import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { getLatestWindowSummaries } from "@/lib/xmonitor/repository";
import type { WindowSummariesLatestResponse } from "@/lib/xmonitor/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const proxied = await maybeProxyApiRequest(request);
  if (proxied) {
    return proxied;
  }

  try {
    ensureDatabaseConfigured();
    const items = await getLatestWindowSummaries();
    const payload: WindowSummariesLatestResponse = { items };
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to query latest window summaries", 503);
  }
}
