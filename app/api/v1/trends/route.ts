import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { getTrends } from "@/lib/xmonitor/repository";
import type { TrendsResponse } from "@/lib/xmonitor/types";
import { parseFeedQuery } from "@/lib/xmonitor/validators";

export const runtime = "nodejs";

function firstString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

function parseTrendRange(value: string | undefined): "24h" | "7d" | "30d" | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "24h" || normalized === "7d" || normalized === "30d") {
    return normalized;
  }
  return null;
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
  const trendRange = parseTrendRange(firstString(queryInput.trend_range) || firstString(queryInput.engagement_range));

  try {
    ensureDatabaseConfigured();
    const payload: TrendsResponse = await getTrends(query, {
      applyTextQuery,
      rangeKey: trendRange,
    });
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to query trends", 503);
  }
}
