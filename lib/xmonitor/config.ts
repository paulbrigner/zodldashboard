const DEFAULT_SERVICE_NAME = "xmonitor-api";
const DEFAULT_VERSION = "v1";
const DEFAULT_FEED_LIMIT = 50;
const DEFAULT_MAX_FEED_LIMIT = 200;

export function serviceName(): string {
  return process.env.XMONITOR_API_SERVICE_NAME || DEFAULT_SERVICE_NAME;
}

export function apiVersion(): string {
  return process.env.XMONITOR_API_VERSION || DEFAULT_VERSION;
}

export function defaultFeedLimit(): number {
  const value = Number.parseInt(process.env.XMONITOR_DEFAULT_FEED_LIMIT || "", 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_FEED_LIMIT;
}

export function maxFeedLimit(): number {
  const value = Number.parseInt(process.env.XMONITOR_MAX_FEED_LIMIT || "", 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_FEED_LIMIT;
}

export function hasDatabaseConfig(): boolean {
  return Boolean(process.env.DATABASE_URL) || Boolean(process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER);
}
