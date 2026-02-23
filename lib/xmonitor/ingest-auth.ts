import { timingSafeEqual } from "node:crypto";
import { jsonError } from "@/lib/xmonitor/http";

function asString(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function configuredSharedSecret(): string | null {
  return asString(process.env.XMONITOR_INGEST_SHARED_SECRET) || asString(process.env.XMONITOR_API_KEY);
}

function extractBearerToken(value: string | null): string | null {
  const text = asString(value);
  if (!text) return null;
  const match = /^Bearer\s+(.+)$/i.exec(text);
  if (!match) return null;
  return asString(match[1]);
}

function timingSafeMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  if (expectedBytes.length !== actualBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, actualBytes);
}

export function requireIngestAuth(request: Request): Response | null {
  const expectedSecret = configuredSharedSecret();
  if (!expectedSecret) {
    return jsonError("ingest auth is not configured. Set XMONITOR_INGEST_SHARED_SECRET.", 503);
  }

  const apiKey = asString(request.headers.get("x-api-key"));
  const bearer = extractBearerToken(request.headers.get("authorization"));
  const presentedSecret = apiKey || bearer;

  if (!presentedSecret || !timingSafeMatch(expectedSecret, presentedSecret)) {
    return jsonError("unauthorized", 401);
  }

  return null;
}
