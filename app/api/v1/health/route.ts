import { apiVersion, hasDatabaseConfig, serviceName } from "@/lib/xmonitor/config";
import { maybeProxyApiRequest } from "@/lib/xmonitor/backend-api";
import { jsonOk } from "@/lib/xmonitor/http";
import { pingDatabase } from "@/lib/xmonitor/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const proxied = await maybeProxyApiRequest(request);
  if (proxied) {
    return proxied;
  }

  const dbConfigured = hasDatabaseConfig();
  let database: "ok" | "not_configured" | "error" = "not_configured";

  if (dbConfigured) {
    try {
      await pingDatabase();
      database = "ok";
    } catch {
      database = "error";
    }
  }

  return jsonOk({
    ok: database !== "error",
    service: serviceName(),
    version: apiVersion(),
    database,
  });
}
