import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type IpSourceStrategy = "strict" | "rightmost";

type LocalBypassConfig = {
  enabled: boolean;
  killSwitch: boolean;
  ddnsHost: string | null;
  refreshMs: number;
  ipSourceStrategy: IpSourceStrategy;
  trustedProxyIps: Set<string>;
  staticAllowlistIps: Set<string>;
  clientIpHeader: string | null;
  logDecisions: boolean;
};

type DdnsCacheEntry = {
  expiresAt: number;
  ips: Set<string>;
};

export type LocalBypassDecision = {
  allowed: boolean;
  reason: string;
  clientIp: string | null;
  allowlistIps: string[];
  sourceHost: string | null;
};

const DEFAULT_REFRESH_MS = 5 * 60 * 1000;
const MIN_REFRESH_MS = 15 * 1000;
const ddnsCache = new Map<string, DdnsCacheEntry>();

function readBoolean(raw: string | undefined, defaultValue = false): boolean {
  if (raw === undefined) return defaultValue;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function readPositiveInt(raw: string | undefined, defaultValue: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

function unwrapForwardedForToken(value: string): string {
  const trimmed = value.trim().replace(/^"+|"+$/g, "");
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("for=")) {
    return trimmed.slice(4).trim().replace(/^"+|"+$/g, "");
  }
  return trimmed;
}

function normalizeIpCandidate(value: string): string | null {
  const token = unwrapForwardedForToken(value);
  if (!token) return null;

  // [ipv6]:port
  if (token.startsWith("[") && token.includes("]")) {
    const close = token.indexOf("]");
    const inner = token.slice(1, close);
    if (isIP(inner) === 6) return inner.toLowerCase();
  }

  // ipv4:port
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(token)) {
    const [host] = token.split(":");
    if (host && isIP(host) === 4) return host;
  }

  // ipv6:port (unbracketed)
  const lastColon = token.lastIndexOf(":");
  if (lastColon > 0) {
    const maybeHost = token.slice(0, lastColon);
    const maybePort = token.slice(lastColon + 1);
    if (/^\d+$/.test(maybePort) && isIP(maybeHost) === 6) {
      return maybeHost.toLowerCase();
    }
  }

  if (token.startsWith("::ffff:")) {
    const mapped = token.slice("::ffff:".length);
    if (isIP(mapped) === 4) return mapped;
  }

  const ipType = isIP(token);
  if (ipType === 4) return token;
  if (ipType === 6) return token.toLowerCase();
  return null;
}

function parseIpList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((entry) => normalizeIpCandidate(entry))
      .filter((entry): entry is string => Boolean(entry))
  );
}

function readConfig(): LocalBypassConfig {
  const refreshSeconds = readPositiveInt(process.env.LOCAL_BYPASS_REFRESH_SECONDS, 300);
  const refreshMs = Math.max(refreshSeconds * 1000, MIN_REFRESH_MS);
  const strategyRaw = (process.env.LOCAL_BYPASS_IP_SOURCE_STRATEGY || "strict").trim().toLowerCase();
  const ipSourceStrategy: IpSourceStrategy = strategyRaw === "rightmost" ? "rightmost" : "strict";
  const ddnsHost = (process.env.LOCAL_BYPASS_DDNS_HOST || "").trim().toLowerCase() || null;
  const clientIpHeader = (process.env.LOCAL_BYPASS_CLIENT_IP_HEADER || "").trim().toLowerCase() || null;

  return {
    enabled: readBoolean(process.env.LOCAL_BYPASS_ENABLED, false),
    killSwitch: readBoolean(process.env.LOCAL_BYPASS_KILL_SWITCH, false),
    ddnsHost,
    refreshMs: Number.isFinite(refreshMs) ? refreshMs : DEFAULT_REFRESH_MS,
    ipSourceStrategy,
    trustedProxyIps: parseIpList(process.env.LOCAL_BYPASS_TRUSTED_PROXY_IPS),
    staticAllowlistIps: parseIpList(process.env.LOCAL_BYPASS_ALLOWLIST_IPS),
    clientIpHeader,
    logDecisions: readBoolean(process.env.LOCAL_BYPASS_LOG_DECISIONS, true),
  };
}

function parseXForwardedFor(rawValue: string | null): string[] {
  if (!rawValue) return [];
  return rawValue
    .split(",")
    .map((entry) => normalizeIpCandidate(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function resolveClientIpFromXForwardedFor(headers: Headers, config: LocalBypassConfig): { ip: string | null; reason: string } {
  const hops = parseXForwardedFor(headers.get("x-forwarded-for"));
  if (hops.length === 0) return { ip: null, reason: "missing_x_forwarded_for" };

  if (config.ipSourceStrategy === "rightmost") {
    return { ip: hops[hops.length - 1] || null, reason: "xff_rightmost" };
  }

  if (config.trustedProxyIps.size === 0) {
    return { ip: null, reason: "strict_mode_requires_trusted_proxy_ips" };
  }

  let idx = hops.length - 1;
  while (idx >= 0 && config.trustedProxyIps.has(hops[idx] || "")) {
    idx -= 1;
  }

  // Strict mode requires at least one trusted proxy hop to be present.
  if (idx === hops.length - 1) {
    return { ip: null, reason: "strict_mode_untrusted_nearest_proxy" };
  }

  if (idx < 0) {
    return { ip: null, reason: "strict_mode_all_hops_are_trusted_proxies" };
  }

  return { ip: hops[idx] || null, reason: "xff_strict" };
}

function resolveClientIp(headers: Headers, config: LocalBypassConfig): { ip: string | null; reason: string } {
  if (config.clientIpHeader) {
    const headerValue = headers.get(config.clientIpHeader);
    const firstHeaderToken = (headerValue || "").split(",")[0] || "";
    const ip = normalizeIpCandidate(firstHeaderToken);
    if (ip) {
      return { ip, reason: `header_${config.clientIpHeader}` };
    }
    return { ip: null, reason: `invalid_${config.clientIpHeader}_header` };
  }

  return resolveClientIpFromXForwardedFor(headers, config);
}

async function resolveDdnsIps(host: string, refreshMs: number): Promise<Set<string>> {
  const now = Date.now();
  const cached = ddnsCache.get(host);
  if (cached && cached.expiresAt > now) {
    return new Set(cached.ips);
  }

  try {
    const records = await lookup(host, { all: true, verbatim: true });
    const ips = new Set<string>();
    records.forEach((record) => {
      const normalized = normalizeIpCandidate(record.address);
      if (normalized) {
        ips.add(normalized);
      }
    });
    ddnsCache.set(host, { ips, expiresAt: now + refreshMs });
    return new Set(ips);
  } catch (error) {
    console.error(`[auth][local-bypass] failed to resolve LOCAL_BYPASS_DDNS_HOST (${host}):`, error);
    ddnsCache.set(host, { ips: new Set(), expiresAt: now + Math.min(refreshMs, 60_000) });
    return new Set();
  }
}

async function buildAllowlist(config: LocalBypassConfig): Promise<Set<string>> {
  const allowlist = new Set<string>(config.staticAllowlistIps);
  if (!config.ddnsHost) return allowlist;

  const ddnsIps = await resolveDdnsIps(config.ddnsHost, config.refreshMs);
  ddnsIps.forEach((ip) => allowlist.add(ip));
  return allowlist;
}

function logDecision(config: LocalBypassConfig, pathname: string, decision: LocalBypassDecision): void {
  if (!config.logDecisions || !config.enabled) return;
  const line =
    `[auth][local-bypass] ${decision.allowed ? "allow" : "deny"} ` +
    `path=${pathname} reason=${decision.reason} ` +
    `client_ip=${decision.clientIp || "-"} ` +
    `allowlist_count=${decision.allowlistIps.length}`;
  if (decision.allowed) {
    console.info(line);
  } else {
    console.warn(line);
  }
}

export async function evaluateLocalBypass(headers: Headers, pathname: string): Promise<LocalBypassDecision> {
  const config = readConfig();
  if (!config.enabled) {
    return {
      allowed: false,
      reason: "disabled",
      clientIp: null,
      allowlistIps: [],
      sourceHost: config.ddnsHost,
    };
  }

  if (config.killSwitch) {
    const decision: LocalBypassDecision = {
      allowed: false,
      reason: "kill_switch",
      clientIp: null,
      allowlistIps: [],
      sourceHost: config.ddnsHost,
    };
    logDecision(config, pathname, decision);
    return decision;
  }

  const allowlist = await buildAllowlist(config);
  const sortedAllowlist = [...allowlist].sort();
  if (allowlist.size === 0) {
    const decision: LocalBypassDecision = {
      allowed: false,
      reason: "empty_allowlist",
      clientIp: null,
      allowlistIps: sortedAllowlist,
      sourceHost: config.ddnsHost,
    };
    logDecision(config, pathname, decision);
    return decision;
  }

  const clientResolution = resolveClientIp(headers, config);
  if (!clientResolution.ip) {
    const decision: LocalBypassDecision = {
      allowed: false,
      reason: clientResolution.reason,
      clientIp: null,
      allowlistIps: sortedAllowlist,
      sourceHost: config.ddnsHost,
    };
    logDecision(config, pathname, decision);
    return decision;
  }

  const allowed = allowlist.has(clientResolution.ip);
  const decision: LocalBypassDecision = {
    allowed,
    reason: allowed ? "client_ip_allowlisted" : "client_ip_not_allowlisted",
    clientIp: clientResolution.ip,
    allowlistIps: sortedAllowlist,
    sourceHost: config.ddnsHost,
  };
  logDecision(config, pathname, decision);
  return decision;
}
