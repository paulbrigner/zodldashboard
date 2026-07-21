export const XMONITOR_READ_CLIENT_ID_HEADER = "x-xmonitor-client-id";
export const XMONITOR_READ_CLIENT_SECRET_HEADER = "x-xmonitor-client-secret";

const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MIN_CLIENT_SECRET_LENGTH = 32;

function configuredValue(value: string | undefined): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export function isXMonitorReadApiPath(pathname: string): boolean {
  const normalized = pathname.startsWith("/api/v1/")
    ? `/v1/${pathname.slice("/api/v1/".length)}`
    : pathname;

  return (
    normalized === "/v1/feed" ||
    normalized === "/v1/author-locations" ||
    normalized === "/v1/engagement" ||
    normalized === "/v1/trends" ||
    normalized === "/v1/window-summaries/latest" ||
    normalized === "/v1/curated-briefings" ||
    /^\/v1\/curated-briefings\/[^/]+$/.test(normalized) ||
    /^\/v1\/posts\/[^/]+$/.test(normalized)
  );
}

export function buildXMonitorReadClientHeaders(): Record<string, string> | null {
  const clientId = configuredValue(process.env.XMONITOR_READ_CLIENT_ID);
  const clientSecret = configuredValue(process.env.XMONITOR_READ_CLIENT_SECRET);

  if (!clientId && !clientSecret) {
    return null;
  }
  if (!clientId || !clientSecret) {
    throw new Error(
      "X Monitor read client auth requires both XMONITOR_READ_CLIENT_ID and XMONITOR_READ_CLIENT_SECRET"
    );
  }
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error("XMONITOR_READ_CLIENT_ID has an invalid format");
  }
  if (clientSecret.length < MIN_CLIENT_SECRET_LENGTH) {
    throw new Error("XMONITOR_READ_CLIENT_SECRET must be at least 32 characters");
  }

  return {
    [XMONITOR_READ_CLIENT_ID_HEADER]: clientId,
    [XMONITOR_READ_CLIENT_SECRET_HEADER]: clientSecret,
  };
}
