import { ensureDatabaseConfigured } from "@/lib/xmonitor/db";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import { getPostDetail } from "@/lib/xmonitor/repository";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ statusId: string }> }
) {
  const proxied = await maybeProxyApiRequest(request);
  if (proxied) {
    return proxied;
  }

  const { statusId } = await context.params;
  if (!statusId) {
    return jsonError("statusId is required", 400);
  }

  try {
    ensureDatabaseConfigured();
    const detail = await getPostDetail(statusId);
    if (!detail) {
      return jsonError("not found", 404);
    }
    return jsonOk(detail);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to query post detail", 503);
  }
}
