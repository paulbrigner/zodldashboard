import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { composeEnabled } from "@/lib/xmonitor/compose";
import { jsonError } from "@/lib/xmonitor/http";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  if (!composeEnabled()) {
    return jsonError("compose query is disabled", 503);
  }

  const backendBase = backendApiBaseUrl();
  if (!backendBase) {
    return jsonError("compose query requires XMONITOR_BACKEND_API_BASE_URL to be configured", 503);
  }

  const { jobId } = await context.params;
  if (!jobId) {
    return jsonError("jobId is required", 400);
  }

  try {
    const response = await fetch(`${backendBase}/query/compose/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const cacheControl = response.headers.get("cache-control");
    if (cacheControl) headers.set("cache-control", cacheControl);

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to read compose job", 503);
  }
}
