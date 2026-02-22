import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { getFeed } from "@/lib/xmonitor/repository";
import { parseFeedQuery } from "@/lib/xmonitor/validators";

export const runtime = "nodejs";

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

  try {
    ensureDatabaseConfigured();
    const feed = await getFeed(query);
    return jsonOk(feed);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to query feed", 503);
  }
}
