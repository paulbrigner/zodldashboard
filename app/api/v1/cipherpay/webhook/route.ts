import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonError } from "@/lib/xmonitor/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const proxied = await maybeProxyApiRequest(request);
  if (proxied) {
    return proxied;
  }
  return jsonError("CipherPay webhook requires XMONITOR_BACKEND_API_BASE_URL to be configured", 503);
}
