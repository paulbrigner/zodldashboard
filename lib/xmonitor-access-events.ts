import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";
import type { AuthenticatedViewer } from "@/lib/viewer-auth";

const VIEWER_EMAIL_HEADER = "x-xmonitor-viewer-email";
const VIEWER_MODE_HEADER = "x-xmonitor-viewer-auth-mode";
const VIEWER_PROXY_SECRET_HEADER = "x-xmonitor-viewer-secret";
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_PATH = "/x-monitor";
const DEFAULT_METHOD = "GET";
const DEFAULT_STATUS_CODE = 200;

type HeaderReader = {
  get(name: string): string | null;
};

type XMonitorAccessEventInput = {
  viewer: AuthenticatedViewer;
  headers: HeaderReader;
  path?: string;
  method?: string;
  statusCode?: number;
};

type XMonitorAccessEventPayload = {
  event: "zodl_xmonitor_access";
  path: string;
  method: string;
  status_code: number;
  email: string;
  auth_mode: AuthenticatedViewer["mode"];
  access_level: AuthenticatedViewer["accessLevel"];
  client_ip: string | null;
  bypass_client_ip: string | null;
  user_agent: string | null;
  referer: string | null;
  request_id: string | null;
  at: string;
};

function withLengthLimit(value: string | null, maxLength: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function firstHeaderToken(value: string | null): string | null {
  return withLengthLimit((value || "").split(",")[0] || null, 128);
}

function headerValue(headers: HeaderReader, name: string, maxLength: number): string | null {
  return withLengthLimit(headers.get(name), maxLength);
}

function proxySecret(): string | null {
  return withLengthLimit(process.env.XMONITOR_USER_PROXY_SECRET || null, 4096);
}

function requestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.XMONITOR_ACCESS_LOG_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function buildPayload(input: XMonitorAccessEventInput): XMonitorAccessEventPayload {
  const requestId =
    headerValue(input.headers, "x-request-id", 256) ||
    headerValue(input.headers, "x-amzn-trace-id", 512) ||
    headerValue(input.headers, "x-amplify-request-id", 256);

  return {
    event: "zodl_xmonitor_access",
    path: input.path || DEFAULT_PATH,
    method: (input.method || DEFAULT_METHOD).toUpperCase(),
    status_code: input.statusCode || DEFAULT_STATUS_CODE,
    email: input.viewer.email,
    auth_mode: input.viewer.mode,
    access_level: input.viewer.accessLevel,
    client_ip:
      firstHeaderToken(input.headers.get("x-forwarded-for")) ||
      headerValue(input.headers, "x-real-ip", 128) ||
      input.viewer.bypassClientIp,
    bypass_client_ip: input.viewer.bypassClientIp,
    user_agent: headerValue(input.headers, "user-agent", 1024),
    referer: headerValue(input.headers, "referer", 1024),
    request_id: requestId,
    at: new Date().toISOString(),
  };
}

async function recordViaBackend(payload: XMonitorAccessEventPayload): Promise<boolean> {
  const baseUrl = backendApiBaseUrl();
  const secret = proxySecret();
  if (!baseUrl || !secret) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}/x-monitor/access-events`, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        [VIEWER_EMAIL_HEADER]: payload.email,
        [VIEWER_MODE_HEADER]: payload.auth_mode,
        [VIEWER_PROXY_SECRET_HEADER]: secret,
      },
      body: JSON.stringify({
        path: payload.path,
        method: payload.method,
        status_code: payload.status_code,
        access_level: payload.access_level,
        client_ip: payload.client_ip,
        user_agent: payload.user_agent,
        referer: payload.referer,
        request_id: payload.request_id,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().slice(0, 240);
      throw new Error(`backend X Monitor access audit failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }

    return true;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function recordDirectly(payload: XMonitorAccessEventPayload): Promise<boolean> {
  if (!hasDatabaseConfig()) return false;

  const { getDbPool } = await import("@/lib/xmonitor/db");
  await getDbPool().query(
    `
      INSERT INTO xmonitor_access_events(
        email,
        auth_mode,
        access_level,
        path,
        method,
        status_code,
        client_ip,
        user_agent,
        referer,
        request_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      payload.email,
      payload.auth_mode,
      payload.access_level,
      payload.path,
      payload.method,
      payload.status_code,
      payload.client_ip,
      payload.user_agent,
      payload.referer,
      payload.request_id,
    ]
  );
  return true;
}

export async function recordXMonitorAccess(input: XMonitorAccessEventInput): Promise<void> {
  const payload = buildPayload(input);

  console.info(JSON.stringify(payload));

  try {
    if (await recordViaBackend(payload)) {
      return;
    }

    if (await recordDirectly(payload)) {
      return;
    }

    console.warn(
      JSON.stringify({
        event: "zodl_xmonitor_access_audit_skipped",
        reason: "no_backend_or_database",
        email: payload.email,
        at: new Date().toISOString(),
      })
    );
  } catch (error) {
    try {
      if (await recordDirectly(payload)) {
        console.warn(
          JSON.stringify({
            event: "zodl_xmonitor_access_audit_backend_fallback",
            email: payload.email,
            reason: error instanceof Error ? error.message : "backend_failed",
            at: new Date().toISOString(),
          })
        );
        return;
      }
    } catch (fallbackError) {
      console.warn(
        JSON.stringify({
          event: "zodl_xmonitor_access_audit_failed",
          email: payload.email,
          reason: fallbackError instanceof Error ? fallbackError.message : "db_failed",
          at: new Date().toISOString(),
        })
      );
      return;
    }

    console.warn(
      JSON.stringify({
        event: "zodl_xmonitor_access_audit_failed",
        email: payload.email,
        reason: error instanceof Error ? error.message : "unknown",
        at: new Date().toISOString(),
      })
    );
  }
}
