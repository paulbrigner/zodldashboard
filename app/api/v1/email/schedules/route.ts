import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { jsonError } from "@/lib/xmonitor/http";

export const runtime = "nodejs";

function proxySecret(): string | null {
  const value = process.env.XMONITOR_USER_PROXY_SECRET;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function proxyRequest(request: Request, method: "GET" | "POST"): Promise<Response> {
  const backendBase = backendApiBaseUrl();
  if (!backendBase) {
    return jsonError("email schedules require XMONITOR_BACKEND_API_BASE_URL to be configured", 503);
  }

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase() || "";
  if (!email) {
    return jsonError("authentication required", 401);
  }

  const secret = proxySecret();
  if (!secret) {
    return jsonError("XMONITOR_USER_PROXY_SECRET is not configured", 503);
  }

  const init: RequestInit = {
    method,
    cache: "no-store",
    headers: {
      accept: "application/json",
      "x-xmonitor-viewer-email": email,
      "x-xmonitor-viewer-auth-mode": "oauth",
      "x-xmonitor-viewer-secret": secret,
    },
  };
  if (method === "POST") {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = await request.text();
  }

  try {
    const response = await fetch(`${backendBase}/email/schedules`, init);
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
    return jsonError(error instanceof Error ? error.message : "email schedules proxy failed", 503);
  }
}

export async function GET(request: Request) {
  return proxyRequest(request, "GET");
}

export async function POST(request: Request) {
  return proxyRequest(request, "POST");
}
