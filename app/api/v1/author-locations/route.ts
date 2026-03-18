import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { getAuthorLocationSuggestions } from "@/lib/xmonitor/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const proxied = await maybeProxyApiRequest(request);
  if (proxied) {
    return proxied;
  }

  const { searchParams } = new URL(request.url);
  const limitRaw = Number.parseInt(searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 8;

  try {
    ensureDatabaseConfigured();
    const items = await getAuthorLocationSuggestions(limit);
    return jsonOk({ items });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to query author locations", 503);
  }
}
