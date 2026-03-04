import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { getEngagement } from "@/lib/xmonitor/repository";
import type { EngagementResponse } from "@/lib/xmonitor/types";
import { parseFeedQuery } from "@/lib/xmonitor/validators";

export const runtime = "nodejs";

function firstString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

export async function GET(request: Request) {
  const proxied = await maybeProxyApiRequest(request);
  if (proxied) {
    return proxied;
  }

  const { searchParams } = new URL(request.url);
  const queryInput: Record<string, string | string[] | undefined> = {};

  searchParams.forEach((value, key) => {
    if (queryInput[key] === undefined) {
      queryInput[key] = value;
    }
  });

  const query = parseFeedQuery(queryInput);
  const searchMode = firstString(queryInput.search_mode);
  const applyTextQuery = searchMode !== "semantic";

  try {
    ensureDatabaseConfigured();
    const payload: EngagementResponse = await getEngagement(query, { applyTextQuery });
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to query engagement", 503);
  }
}
