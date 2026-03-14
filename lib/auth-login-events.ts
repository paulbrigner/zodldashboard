import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";

const VIEWER_EMAIL_HEADER = "x-xmonitor-viewer-email";
const VIEWER_MODE_HEADER = "x-xmonitor-viewer-auth-mode";
const VIEWER_PROXY_SECRET_HEADER = "x-xmonitor-viewer-secret";
const DEFAULT_TIMEOUT_MS = 5000;

export type AuthLoginAccessLevel = "workspace" | "guest";

type AuthLoginEventInput = {
  email: string;
  provider: string;
  accessLevel: AuthLoginAccessLevel;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeProvider(value: string): string {
  return value.trim().toLowerCase();
}

function proxySecret(): string | null {
  const value = process.env.XMONITOR_USER_PROXY_SECRET;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.XMONITOR_AUTH_LOGIN_EVENT_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function authLoginEventPayload(input: AuthLoginEventInput) {
  return {
    email: normalizeEmail(input.email),
    provider: normalizeProvider(input.provider),
    accessLevel: input.accessLevel,
  };
}

async function recordViaBackend(input: AuthLoginEventInput): Promise<boolean> {
  const baseUrl = backendApiBaseUrl();
  const secret = proxySecret();
  if (!baseUrl || !secret) return false;

  const payload = authLoginEventPayload(input);
  if (!payload.email || !payload.provider) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}/auth/login-events`, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        [VIEWER_EMAIL_HEADER]: payload.email,
        [VIEWER_MODE_HEADER]: "oauth",
        [VIEWER_PROXY_SECRET_HEADER]: secret,
      },
      body: JSON.stringify({
        provider: payload.provider,
        access_level: payload.accessLevel,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().slice(0, 240);
      throw new Error(`backend login audit failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }

    return true;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function recordDirectly(input: AuthLoginEventInput): Promise<boolean> {
  if (!hasDatabaseConfig()) return false;

  const payload = authLoginEventPayload(input);
  if (!payload.email || !payload.provider) return false;

  const { getDbPool } = await import("@/lib/xmonitor/db");
  await getDbPool().query(
    `
      INSERT INTO auth_login_events(email, provider, auth_mode, access_level)
      VALUES ($1, $2, 'oauth', $3)
    `,
    [payload.email, payload.provider, payload.accessLevel]
  );
  return true;
}

export async function recordSuccessfulOAuthLogin(input: AuthLoginEventInput): Promise<void> {
  const payload = authLoginEventPayload(input);
  if (!payload.email || !payload.provider) {
    return;
  }

  try {
    if (await recordViaBackend(payload)) {
      return;
    }

    if (await recordDirectly(payload)) {
      return;
    }

    console.warn(
      `[auth] login audit skipped email=${payload.email} provider=${payload.provider} reason=no_backend_or_database`
    );
  } catch (error) {
    try {
      if (await recordDirectly(payload)) {
        console.warn(
          `[auth] login audit backend fallback email=${payload.email} provider=${payload.provider} reason=${error instanceof Error ? error.message : "backend_failed"}`
        );
        return;
      }
    } catch (fallbackError) {
      console.warn(
        `[auth] login audit failed email=${payload.email} provider=${payload.provider} reason=${fallbackError instanceof Error ? fallbackError.message : "db_failed"}`
      );
      return;
    }

    console.warn(
      `[auth] login audit failed email=${payload.email} provider=${payload.provider} reason=${error instanceof Error ? error.message : "unknown"}`
    );
  }
}
