import { Pool } from "pg";
import { timingSafeEqual } from "node:crypto";

const WATCH_TIERS = new Set(["teammate", "influencer", "ecosystem"]);
const SNAPSHOT_TYPES = new Set(["initial_capture", "latest_observed", "refresh_24h"]);
const RUN_MODES = new Set(["priority", "discovery", "both", "refresh24h", "manual"]);
const COMPOSE_ANSWER_STYLES = new Set(["brief", "balanced", "detailed"]);
const COMPOSE_DRAFT_FORMATS = new Set(["none", "x_post", "thread"]);

const DEFAULT_SERVICE_NAME = "xmonitor-api";
const DEFAULT_API_VERSION = "v1";
const DEFAULT_FEED_LIMIT = 50;
const DEFAULT_MAX_FEED_LIMIT = 200;
const DEFAULT_SEMANTIC_DEFAULT_LIMIT = 25;
const DEFAULT_SEMANTIC_MAX_LIMIT = 100;
const DEFAULT_SEMANTIC_MIN_SCORE = 0;
const DEFAULT_SEMANTIC_RETRIEVAL_FACTOR = 4;
const DEFAULT_EMBEDDING_BASE_URL = "https://api.venice.ai/api/v1";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-bge-m3";
const DEFAULT_EMBEDDING_DIMS = 1024;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 10000;
const DEFAULT_COMPOSE_ENABLED = true;
const DEFAULT_COMPOSE_RETRIEVAL_LIMIT = 40;
const DEFAULT_COMPOSE_MAX_RETRIEVAL_LIMIT = 100;
const DEFAULT_COMPOSE_CONTEXT_LIMIT = 12;
const DEFAULT_COMPOSE_MAX_CONTEXT_LIMIT = 24;
const DEFAULT_INGEST_OMIT_HANDLES = ["zec_88", "zec__2"];

let pool;
let summarySchemaEnsured = false;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFloatOr(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function serviceName() {
  return process.env.XMONITOR_API_SERVICE_NAME || DEFAULT_SERVICE_NAME;
}

function apiVersion() {
  return process.env.XMONITOR_API_VERSION || DEFAULT_API_VERSION;
}

function defaultFeedLimit() {
  return parsePositiveInt(process.env.XMONITOR_DEFAULT_FEED_LIMIT, DEFAULT_FEED_LIMIT);
}

function maxFeedLimit() {
  return parsePositiveInt(process.env.XMONITOR_MAX_FEED_LIMIT, DEFAULT_MAX_FEED_LIMIT);
}

function semanticEnabled() {
  const value = asString(process.env.XMONITOR_SEMANTIC_ENABLED);
  if (!value) return true;
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function semanticDefaultLimit() {
  return parsePositiveInt(process.env.XMONITOR_SEMANTIC_DEFAULT_LIMIT, DEFAULT_SEMANTIC_DEFAULT_LIMIT);
}

function semanticMaxLimit() {
  return parsePositiveInt(process.env.XMONITOR_SEMANTIC_MAX_LIMIT, DEFAULT_SEMANTIC_MAX_LIMIT);
}

function semanticMinScore() {
  return parseFloatOr(process.env.XMONITOR_SEMANTIC_MIN_SCORE, DEFAULT_SEMANTIC_MIN_SCORE);
}

function semanticRetrievalFactor() {
  return parsePositiveInt(process.env.XMONITOR_SEMANTIC_RETRIEVAL_FACTOR, DEFAULT_SEMANTIC_RETRIEVAL_FACTOR);
}

function composeEnabled() {
  const value = asString(process.env.XMONITOR_COMPOSE_ENABLED);
  if (!value) return DEFAULT_COMPOSE_ENABLED;
  const normalized = value.toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return DEFAULT_COMPOSE_ENABLED;
}

function composeDefaultRetrievalLimit() {
  return parsePositiveInt(process.env.XMONITOR_COMPOSE_DEFAULT_RETRIEVAL_LIMIT, DEFAULT_COMPOSE_RETRIEVAL_LIMIT);
}

function composeMaxRetrievalLimit() {
  return parsePositiveInt(process.env.XMONITOR_COMPOSE_MAX_RETRIEVAL_LIMIT, DEFAULT_COMPOSE_MAX_RETRIEVAL_LIMIT);
}

function composeDefaultContextLimit() {
  return parsePositiveInt(process.env.XMONITOR_COMPOSE_DEFAULT_CONTEXT_LIMIT, DEFAULT_COMPOSE_CONTEXT_LIMIT);
}

function composeMaxContextLimit() {
  return parsePositiveInt(process.env.XMONITOR_COMPOSE_MAX_CONTEXT_LIMIT, DEFAULT_COMPOSE_MAX_CONTEXT_LIMIT);
}

function embeddingBaseUrl() {
  const configured = asString(process.env.XMONITOR_EMBEDDING_BASE_URL);
  return (configured || DEFAULT_EMBEDDING_BASE_URL).replace(/\/+$/, "");
}

function embeddingModel() {
  return asString(process.env.XMONITOR_EMBEDDING_MODEL) || DEFAULT_EMBEDDING_MODEL;
}

function embeddingDims() {
  return parsePositiveInt(process.env.XMONITOR_EMBEDDING_DIMS, DEFAULT_EMBEDDING_DIMS);
}

function embeddingTimeoutMs() {
  return parsePositiveInt(process.env.XMONITOR_EMBEDDING_TIMEOUT_MS, DEFAULT_EMBEDDING_TIMEOUT_MS);
}

function embeddingApiKey() {
  return asString(process.env.XMONITOR_EMBEDDING_API_KEY) || asString(process.env.VENICE_API_KEY);
}

function ingestSharedSecret() {
  return asString(process.env.XMONITOR_INGEST_SHARED_SECRET) || asString(process.env.XMONITOR_API_KEY);
}

function shouldBootstrapSummarySchema() {
  const value = asString(process.env.XMONITOR_ENABLE_SUMMARY_SCHEMA_BOOTSTRAP);
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function quoteIdent(identifier) {
  return `"${String(identifier || "").replace(/"/g, "\"\"")}"`;
}

function hasDatabaseConfig() {
  return Boolean(process.env.DATABASE_URL) || Boolean(process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER);
}

function poolConfigFromEnv() {
  const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
  const ssl = sslMode && sslMode !== "disable" ? { rejectUnauthorized: false } : undefined;
  const max = parsePositiveInt(process.env.PGPOOL_MAX, 5);

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl,
      max,
      idleTimeoutMillis: 10000,
    };
  }

  const host = process.env.PGHOST;
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD || "";
  const port = parsePositiveInt(process.env.PGPORT, 5432);

  if (!host || !database || !user) {
    throw new Error("Missing database configuration. Set DATABASE_URL or PGHOST/PGDATABASE/PGUSER.");
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl,
    max,
    idleTimeoutMillis: 10000,
  };
}

function getPool() {
  if (!pool) {
    pool = new Pool(poolConfigFromEnv());
  }
  return pool;
}

function normalizePath(path) {
  const raw = typeof path === "string" && path.trim() ? path.trim() : "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (withSlash === "/api/v1") return "/v1";
  if (withSlash.startsWith("/api/v1/")) {
    return `/v1/${withSlash.slice("/api/v1/".length)}`;
  }
  return withSlash;
}

function isIngestPath(path) {
  return path === "/v1/ingest/runs" || /^\/v1\/ingest\/[^/]+\/batch$/.test(path);
}

function isOpsPath(path) {
  return path === "/v1/ops/reconcile-counts" || path === "/v1/ops/purge-handle";
}

function timingSafeMatch(expected, actual) {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  if (expectedBytes.length !== actualBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, actualBytes);
}

function extractBearerToken(headerValue) {
  const text = asString(headerValue);
  if (!text) return null;
  const match = /^Bearer\s+(.+)$/i.exec(text);
  if (!match) return null;
  return asString(match[1]) || null;
}

function headerValue(headers, name) {
  if (!isRecord(headers)) return undefined;
  const candidates = [name, name.toLowerCase(), name.toUpperCase()];
  for (const candidate of candidates) {
    const value = headers[candidate];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function validateIngestAuthorization(event) {
  const expectedSecret = ingestSharedSecret();
  if (!expectedSecret) {
    return {
      ok: false,
      status: 503,
      error: "ingest auth is not configured. Set XMONITOR_INGEST_SHARED_SECRET.",
    };
  }

  const headers = event?.headers;
  const apiKey = asString(headerValue(headers, "x-api-key"));
  const bearer = extractBearerToken(headerValue(headers, "authorization"));
  const presentedSecret = apiKey || bearer;

  if (!presentedSecret || !timingSafeMatch(expectedSecret, presentedSecret)) {
    return {
      ok: false,
      status: 401,
      error: "unauthorized",
    };
  }

  return { ok: true };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function jsonOk(body, statusCode = 200) {
  return jsonResponse(statusCode, body);
}

function jsonError(message, statusCode = 400) {
  return jsonResponse(statusCode, { error: message });
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function asString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNullableString(value) {
  if (value === null) return null;
  return asString(value);
}

function asObject(value) {
  if (!isRecord(value)) return undefined;
  return value;
}

function asArray(value) {
  if (!Array.isArray(value)) return undefined;
  return value;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return undefined;
  const out = [];
  for (const item of value) {
    const text = asString(item);
    if (!text) return undefined;
    out.push(text);
  }
  return out;
}

function asNumberArray(value) {
  if (!Array.isArray(value)) return undefined;
  const out = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) return undefined;
    out.push(item);
  }
  return out;
}

function asJson(value) {
  return JSON.stringify(value ?? null);
}

function vectorLiteral(values) {
  if (!Array.isArray(values)) return "[]";
  return `[${values.map((value) => Number(value)).join(",")}]`;
}

function asBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function asInteger(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asIsoTimestamp(value) {
  const text = asString(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function defaultSinceIso() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function parseSinceIso(value) {
  const text = asString(value);
  if (!text) return defaultSinceIso();
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function normalizeHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function parseNormalizedHandleList(value) {
  if (!value) return [];

  const handles = String(value)
    .split(/[,\s]+/)
    .map((item) => normalizeHandle(item))
    .filter((item) => item.length > 0);

  return [...new Set(handles)];
}

function ingestOmitHandleSet() {
  return new Set([
    ...DEFAULT_INGEST_OMIT_HANDLES,
    ...parseNormalizedHandleList(process.env.XMONITOR_INGEST_OMIT_HANDLES),
  ]);
}

function isKeywordSourceQuery(sourceQuery) {
  const normalized = String(sourceQuery || "")
    .trim()
    .toLowerCase();
  return normalized === "discovery" || normalized === "keyword" || normalized === "both" || normalized === "legacy";
}

function shouldOmitKeywordOriginPost(item, authorHandle, omitHandles) {
  if (!omitHandles.has(authorHandle)) return false;
  if (!isKeywordSourceQuery(item.source_query)) return false;
  if (item.watch_tier && String(item.watch_tier).trim().length > 0) return false;
  return true;
}

function parseHandleFilter(value) {
  return parseNormalizedHandleList(value);
}

function firstValue(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

function encodeFeedCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeFeedCursor(cursor) {
  try {
    const raw = Buffer.from(String(cursor), "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.discovered_at !== "string") return null;
    if (typeof parsed.status_id !== "string") return null;
    return { discovered_at: parsed.discovered_at, status_id: parsed.status_id };
  } catch {
    return null;
  }
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function rowToFeedItem(row) {
  return {
    status_id: String(row.status_id),
    discovered_at: toIso(row.discovered_at) || new Date(0).toISOString(),
    author_handle: String(row.author_handle),
    watch_tier: row.watch_tier ? String(row.watch_tier) : null,
    body_text: row.body_text ? String(row.body_text) : null,
    url: String(row.url),
    is_significant: Boolean(row.is_significant),
    significance_reason: row.significance_reason ? String(row.significance_reason) : null,
    likes: Number(row.likes || 0),
    reposts: Number(row.reposts || 0),
    replies: Number(row.replies || 0),
    views: Number(row.views || 0),
    reported_at: toIso(row.reported_at),
    score: row.score !== undefined && row.score !== null ? Number(row.score) : null,
  };
}

function rowToWindowSummary(row) {
  return {
    summary_key: String(row.summary_key),
    window_type: String(row.window_type),
    window_start: toIso(row.window_start) || new Date(0).toISOString(),
    window_end: toIso(row.window_end) || new Date(0).toISOString(),
    generated_at: toIso(row.generated_at) || new Date(0).toISOString(),
    post_count: Number(row.post_count || 0),
    significant_count: Number(row.significant_count || 0),
    summary_text: String(row.summary_text || ""),
  };
}

function buildBatchResult(received) {
  return {
    received,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

function readJsonBody(event) {
  if (!event || !event.body) {
    return { ok: false, error: "invalid JSON body" };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : String(event.body);

  try {
    return { ok: true, body: JSON.parse(rawBody) };
  } catch {
    return { ok: false, error: "invalid JSON body" };
  }
}

function parseBatchItems(value) {
  if (!isRecord(value)) return { ok: false, error: "body must be an object" };
  if (!Array.isArray(value.items)) return { ok: false, error: "body.items must be an array" };
  return { ok: true, items: value.items };
}

function parsePostUpsert(value) {
  if (!isRecord(value)) return { ok: false, error: "item must be an object" };

  const statusId = asString(value.status_id);
  const url = asString(value.url);
  const authorHandle = asString(value.author_handle)?.toLowerCase();
  const discoveredAt = asIsoTimestamp(value.discovered_at);
  const lastSeenAt = asIsoTimestamp(value.last_seen_at);

  if (!statusId || !url || !authorHandle || !discoveredAt || !lastSeenAt) {
    return { ok: false, error: "status_id, url, author_handle, discovered_at, and last_seen_at are required" };
  }

  const tierRaw = asString(value.watch_tier)?.toLowerCase();
  const watchTier = tierRaw && WATCH_TIERS.has(tierRaw) ? tierRaw : null;

  return {
    ok: true,
    data: {
      status_id: statusId,
      url,
      author_handle: authorHandle,
      author_display: asNullableString(value.author_display),
      body_text: asNullableString(value.body_text),
      posted_relative: asNullableString(value.posted_relative),
      source_query: asNullableString(value.source_query),
      watch_tier: watchTier,
      is_significant: asBoolean(value.is_significant) ?? false,
      significance_reason: asNullableString(value.significance_reason),
      significance_version: asNullableString(value.significance_version) ?? "v1",
      likes: asInteger(value.likes) ?? 0,
      reposts: asInteger(value.reposts) ?? 0,
      replies: asInteger(value.replies) ?? 0,
      views: asInteger(value.views) ?? 0,
      initial_likes: asInteger(value.initial_likes) ?? null,
      initial_reposts: asInteger(value.initial_reposts) ?? null,
      initial_replies: asInteger(value.initial_replies) ?? null,
      initial_views: asInteger(value.initial_views) ?? null,
      likes_24h: asInteger(value.likes_24h) ?? null,
      reposts_24h: asInteger(value.reposts_24h) ?? null,
      replies_24h: asInteger(value.replies_24h) ?? null,
      views_24h: asInteger(value.views_24h) ?? null,
      refresh_24h_at: asIsoTimestamp(value.refresh_24h_at) ?? null,
      refresh_24h_status: asNullableString(value.refresh_24h_status),
      refresh_24h_delta_likes: asInteger(value.refresh_24h_delta_likes) ?? null,
      refresh_24h_delta_reposts: asInteger(value.refresh_24h_delta_reposts) ?? null,
      refresh_24h_delta_replies: asInteger(value.refresh_24h_delta_replies) ?? null,
      refresh_24h_delta_views: asInteger(value.refresh_24h_delta_views) ?? null,
      discovered_at: discoveredAt,
      last_seen_at: lastSeenAt,
    },
  };
}

function parseMetricsSnapshotUpsert(value) {
  if (!isRecord(value)) return { ok: false, error: "item must be an object" };

  const statusId = asString(value.status_id);
  const snapshotType = asString(value.snapshot_type)?.toLowerCase();
  const snapshotAt = asIsoTimestamp(value.snapshot_at);

  if (!statusId || !snapshotType || !snapshotAt) {
    return { ok: false, error: "status_id, snapshot_type, and snapshot_at are required" };
  }

  if (!SNAPSHOT_TYPES.has(snapshotType)) {
    return { ok: false, error: "snapshot_type must be one of initial_capture, latest_observed, refresh_24h" };
  }

  return {
    ok: true,
    data: {
      status_id: statusId,
      snapshot_type: snapshotType,
      snapshot_at: snapshotAt,
      likes: asInteger(value.likes) ?? 0,
      reposts: asInteger(value.reposts) ?? 0,
      replies: asInteger(value.replies) ?? 0,
      views: asInteger(value.views) ?? 0,
      source: asString(value.source) || "ingest",
    },
  };
}

function parseReportUpsert(value) {
  if (!isRecord(value)) return { ok: false, error: "item must be an object" };

  const statusId = asString(value.status_id);
  const reportedAt = asIsoTimestamp(value.reported_at);

  if (!statusId || !reportedAt) {
    return { ok: false, error: "status_id and reported_at are required" };
  }

  return {
    ok: true,
    data: {
      status_id: statusId,
      reported_at: reportedAt,
      channel: asNullableString(value.channel),
      destination: asNullableString(value.destination),
      summary: asNullableString(value.summary),
    },
  };
}

function parsePipelineRunUpsert(value) {
  if (!isRecord(value)) return { ok: false, error: "payload must be an object" };

  const runAt = asIsoTimestamp(value.run_at);
  const mode = asString(value.mode)?.toLowerCase();

  if (!runAt || !mode) {
    return { ok: false, error: "run_at and mode are required" };
  }

  if (!RUN_MODES.has(mode)) {
    return { ok: false, error: "mode must be one of priority, discovery, both, refresh24h, manual" };
  }

  return {
    ok: true,
    data: {
      run_at: runAt,
      mode,
      fetched_count: asInteger(value.fetched_count) ?? 0,
      significant_count: asInteger(value.significant_count) ?? 0,
      reported_count: asInteger(value.reported_count) ?? 0,
      note: asNullableString(value.note),
      source: asNullableString(value.source) ?? "local-dispatcher",
    },
  };
}

function parseWindowSummaryUpsert(value) {
  if (!isRecord(value)) return { ok: false, error: "item must be an object" };

  const summaryKey = asString(value.summary_key);
  const windowType = asString(value.window_type);
  const windowStart = asIsoTimestamp(value.window_start);
  const windowEnd = asIsoTimestamp(value.window_end);
  const generatedAt = asIsoTimestamp(value.generated_at);
  const summaryText = asString(value.summary_text);

  if (!summaryKey || !windowType || !windowStart || !windowEnd || !generatedAt || !summaryText) {
    return {
      ok: false,
      error: "summary_key, window_type, window_start, window_end, generated_at, and summary_text are required",
    };
  }

  return {
    ok: true,
    data: {
      summary_key: summaryKey,
      window_type: windowType,
      window_start: windowStart,
      window_end: windowEnd,
      generated_at: generatedAt,
      post_count: asInteger(value.post_count) ?? 0,
      significant_count: asInteger(value.significant_count) ?? 0,
      tier_counts: asObject(value.tier_counts) ?? {},
      top_themes: asArray(value.top_themes) ?? [],
      debates: asArray(value.debates) ?? [],
      top_authors: asArray(value.top_authors) ?? [],
      notable_posts: asArray(value.notable_posts) ?? [],
      summary_text: summaryText,
      source_version: asNullableString(value.source_version) ?? "v1",
      embedding_backend: asNullableString(value.embedding_backend) ?? null,
      embedding_model: asNullableString(value.embedding_model) ?? null,
      embedding_dims: asInteger(value.embedding_dims) ?? null,
      embedding_vector: asNumberArray(value.embedding_vector) ?? null,
      created_at: asIsoTimestamp(value.created_at) ?? null,
      updated_at: asIsoTimestamp(value.updated_at) ?? null,
    },
  };
}

function parseNarrativeShiftUpsert(value) {
  if (!isRecord(value)) return { ok: false, error: "item must be an object" };

  const shiftKey = asString(value.shift_key);
  const basisWindowType = asString(value.basis_window_type);
  const periodStart = asIsoTimestamp(value.period_start);
  const periodEnd = asIsoTimestamp(value.period_end);
  const generatedAt = asIsoTimestamp(value.generated_at);
  const summaryText = asString(value.summary_text);

  if (!shiftKey || !basisWindowType || !periodStart || !periodEnd || !generatedAt || !summaryText) {
    return {
      ok: false,
      error: "shift_key, basis_window_type, period_start, period_end, generated_at, and summary_text are required",
    };
  }

  return {
    ok: true,
    data: {
      shift_key: shiftKey,
      basis_window_type: basisWindowType,
      period_start: periodStart,
      period_end: periodEnd,
      generated_at: generatedAt,
      source_summary_keys: asStringArray(value.source_summary_keys) ?? [],
      emerging_themes: asArray(value.emerging_themes) ?? [],
      declining_themes: asArray(value.declining_themes) ?? [],
      debate_intensity: asArray(value.debate_intensity) ?? [],
      position_shifts: asObject(value.position_shifts) ?? {},
      summary_text: summaryText,
      source_version: asNullableString(value.source_version) ?? "v1",
      embedding_backend: asNullableString(value.embedding_backend) ?? null,
      embedding_model: asNullableString(value.embedding_model) ?? null,
      embedding_dims: asInteger(value.embedding_dims) ?? null,
      embedding_vector: asNumberArray(value.embedding_vector) ?? null,
      created_at: asIsoTimestamp(value.created_at) ?? null,
      updated_at: asIsoTimestamp(value.updated_at) ?? null,
    },
  };
}

function parseEmbeddingUpsert(value) {
  if (!isRecord(value)) return { ok: false, error: "item must be an object" };

  const statusId = asString(value.status_id);
  const backend = asString(value.backend);
  const model = asString(value.model);
  const dims = asInteger(value.dims);
  const vector = asNumberArray(value.vector);
  const textHash = asString(value.text_hash);
  const createdAt = asIsoTimestamp(value.created_at);
  const updatedAt = asIsoTimestamp(value.updated_at);

  if (!statusId || !backend || !model || !dims || !vector || !textHash || !createdAt || !updatedAt) {
    return {
      ok: false,
      error: "status_id, backend, model, dims, vector, text_hash, created_at, and updated_at are required",
    };
  }

  if (dims <= 0) {
    return { ok: false, error: "dims must be a positive integer" };
  }

  if (vector.length !== dims) {
    return { ok: false, error: "vector length must match dims" };
  }

  return {
    ok: true,
    data: {
      status_id: statusId,
      backend,
      model,
      dims,
      vector,
      text_hash: textHash,
      created_at: createdAt,
      updated_at: updatedAt,
    },
  };
}

function parseFeedQuery(input) {
  const since = asIsoTimestamp(firstValue(input.since));
  const until = asIsoTimestamp(firstValue(input.until));
  const tierRaw = asString(firstValue(input.tier))?.toLowerCase();
  const tier = tierRaw && WATCH_TIERS.has(tierRaw) ? tierRaw : undefined;
  const significant = asBoolean(firstValue(input.significant));

  const limitValue = asInteger(firstValue(input.limit));
  const finalLimit = limitValue
    ? Math.min(Math.max(limitValue, 1), maxFeedLimit())
    : defaultFeedLimit();

  return {
    since,
    until,
    tier,
    handle: asString(firstValue(input.handle))?.toLowerCase(),
    significant,
    q: asString(firstValue(input.q)),
    limit: finalLimit,
    cursor: asString(firstValue(input.cursor)),
  };
}

function parseSemanticQueryBody(value) {
  if (!isRecord(value)) return { ok: false, error: "body must be an object" };

  const queryText = asString(value.query_text);
  const queryVector = asNumberArray(value.query_vector);
  if (!queryText && !queryVector) {
    return { ok: false, error: "query_text or query_vector is required" };
  }

  if (queryVector && queryVector.length !== embeddingDims()) {
    return { ok: false, error: `query_vector length must equal embedding dims (${embeddingDims()})` };
  }

  const since = asIsoTimestamp(value.since);
  const until = asIsoTimestamp(value.until);
  const tierRaw = asString(value.tier)?.toLowerCase();
  const tier = tierRaw && WATCH_TIERS.has(tierRaw) ? tierRaw : undefined;
  const significant = asBoolean(value.significant);

  const limitValue = asInteger(value.limit);
  const maxLimit = semanticMaxLimit();
  const finalLimit = limitValue ? Math.min(Math.max(limitValue, 1), maxLimit) : semanticDefaultLimit();
  const minScoreRaw = parseFloatOr(value.min_score, Number.NaN);

  const normalizedHandle = asString(value.handle)
    ?.toLowerCase()
    .split(/\s+/)
    .filter((item) => item.length > 0)
    .join(" ");

  return {
    ok: true,
    data: {
      query_text: queryText,
      query_vector: queryVector,
      since,
      until,
      tier,
      handle: normalizedHandle || undefined,
      significant,
      limit: finalLimit,
      min_score: Number.isFinite(minScoreRaw) ? minScoreRaw : undefined,
    },
  };
}

function parseComposeQueryBody(value) {
  if (!isRecord(value)) return { ok: false, error: "body must be an object" };

  const taskText = asString(value.task_text);
  if (!taskText) {
    return { ok: false, error: "task_text is required" };
  }

  const queryVector = asNumberArray(value.query_vector);
  if (queryVector && queryVector.length !== embeddingDims()) {
    return { ok: false, error: `query_vector length must equal embedding dims (${embeddingDims()})` };
  }

  const since = asIsoTimestamp(value.since);
  const until = asIsoTimestamp(value.until);
  const tierRaw = asString(value.tier)?.toLowerCase();
  const tier = tierRaw && WATCH_TIERS.has(tierRaw) ? tierRaw : undefined;
  const significant = asBoolean(value.significant);

  const retrievalLimitValue = asInteger(value.retrieval_limit);
  const maxRetrievalLimit = composeMaxRetrievalLimit();
  const retrievalLimit = retrievalLimitValue
    ? Math.min(Math.max(retrievalLimitValue, 1), maxRetrievalLimit)
    : composeDefaultRetrievalLimit();

  const contextLimitValue = asInteger(value.context_limit);
  const maxContextLimit = composeMaxContextLimit();
  const rawContextLimit = contextLimitValue
    ? Math.min(Math.max(contextLimitValue, 1), maxContextLimit)
    : composeDefaultContextLimit();
  const contextLimit = Math.min(rawContextLimit, retrievalLimit);

  const answerStyleRaw = asString(value.answer_style)?.toLowerCase();
  if (answerStyleRaw && !COMPOSE_ANSWER_STYLES.has(answerStyleRaw)) {
    return { ok: false, error: "answer_style must be one of brief, balanced, detailed" };
  }
  const answerStyle = answerStyleRaw || "balanced";

  const draftFormatRaw = asString(value.draft_format)?.toLowerCase();
  if (draftFormatRaw && !COMPOSE_DRAFT_FORMATS.has(draftFormatRaw)) {
    return { ok: false, error: "draft_format must be one of none, x_post, thread" };
  }
  const draftFormat = draftFormatRaw || "none";

  const normalizedHandle = asString(value.handle)
    ?.toLowerCase()
    .split(/\s+/)
    .filter((item) => item.length > 0)
    .join(" ");

  return {
    ok: true,
    data: {
      task_text: taskText,
      query_vector: queryVector,
      since,
      until,
      tier,
      handle: normalizedHandle || undefined,
      significant,
      retrieval_limit: retrievalLimit,
      context_limit: contextLimit,
      answer_style: answerStyle,
      draft_format: draftFormat,
    },
  };
}

async function runUpsert(sql, values) {
  const db = getPool();
  const result = await db.query(sql, values);
  return { inserted: Boolean(result.rows[0]?.inserted) };
}

async function ensureSummaryAnalyticsSchema() {
  if (summarySchemaEnsured || !shouldBootstrapSummarySchema()) {
    return;
  }

  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS window_summaries (
      summary_key TEXT PRIMARY KEY,
      window_type TEXT NOT NULL,
      window_start TIMESTAMPTZ NOT NULL,
      window_end TIMESTAMPTZ NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL,
      post_count INTEGER NOT NULL DEFAULT 0,
      significant_count INTEGER NOT NULL DEFAULT 0,
      tier_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      top_themes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      debates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      top_authors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      notable_posts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      summary_text TEXT NOT NULL,
      source_version TEXT NOT NULL DEFAULT 'v1',
      embedding_backend TEXT,
      embedding_model TEXT,
      embedding_dims INTEGER,
      embedding_vector_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_window_summaries_window_end_desc
      ON window_summaries (window_end DESC);
    CREATE INDEX IF NOT EXISTS idx_window_summaries_type_end_desc
      ON window_summaries (window_type, window_end DESC);

    CREATE TABLE IF NOT EXISTS narrative_shifts (
      shift_key TEXT PRIMARY KEY,
      basis_window_type TEXT NOT NULL,
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL,
      source_summary_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      emerging_themes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      declining_themes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      debate_intensity_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      position_shifts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      summary_text TEXT NOT NULL,
      source_version TEXT NOT NULL DEFAULT 'v1',
      embedding_backend TEXT,
      embedding_model TEXT,
      embedding_dims INTEGER,
      embedding_vector_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_narrative_shifts_period_end_desc
      ON narrative_shifts (period_end DESC);
    CREATE INDEX IF NOT EXISTS idx_narrative_shifts_basis_period_end_desc
      ON narrative_shifts (basis_window_type, period_end DESC);
  `);

  const grantRole = asString(process.env.XMONITOR_SUMMARY_SCHEMA_GRANT_ROLE);
  if (grantRole) {
    const role = quoteIdent(grantRole);
    await db.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE window_summaries TO ${role};
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE narrative_shifts TO ${role};
    `);
  }

  summarySchemaEnsured = true;
}

async function upsertPosts(items) {
  const result = buildBatchResult(items.length);
  const omitHandles = ingestOmitHandleSet();
  const sql = `
    INSERT INTO posts(
      status_id,
      url,
      author_handle,
      author_display,
      body_text,
      posted_relative,
      source_query,
      watch_tier,
      is_significant,
      significance_reason,
      significance_version,
      likes,
      reposts,
      replies,
      views,
      initial_likes,
      initial_reposts,
      initial_replies,
      initial_views,
      likes_24h,
      reposts_24h,
      replies_24h,
      views_24h,
      refresh_24h_at,
      refresh_24h_status,
      refresh_24h_delta_likes,
      refresh_24h_delta_reposts,
      refresh_24h_delta_replies,
      refresh_24h_delta_views,
      discovered_at,
      last_seen_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15,
      $16, $17, $18, $19,
      $20, $21, $22, $23,
      $24, $25, $26, $27, $28, $29,
      $30, $31
    )
    ON CONFLICT (status_id) DO UPDATE SET
      url = EXCLUDED.url,
      author_handle = EXCLUDED.author_handle,
      author_display = EXCLUDED.author_display,
      body_text = EXCLUDED.body_text,
      posted_relative = EXCLUDED.posted_relative,
      source_query = EXCLUDED.source_query,
      watch_tier = EXCLUDED.watch_tier,
      is_significant = EXCLUDED.is_significant,
      significance_reason = EXCLUDED.significance_reason,
      significance_version = EXCLUDED.significance_version,
      likes = EXCLUDED.likes,
      reposts = EXCLUDED.reposts,
      replies = EXCLUDED.replies,
      views = EXCLUDED.views,
      initial_likes = EXCLUDED.initial_likes,
      initial_reposts = EXCLUDED.initial_reposts,
      initial_replies = EXCLUDED.initial_replies,
      initial_views = EXCLUDED.initial_views,
      likes_24h = EXCLUDED.likes_24h,
      reposts_24h = EXCLUDED.reposts_24h,
      replies_24h = EXCLUDED.replies_24h,
      views_24h = EXCLUDED.views_24h,
      refresh_24h_at = EXCLUDED.refresh_24h_at,
      refresh_24h_status = EXCLUDED.refresh_24h_status,
      refresh_24h_delta_likes = EXCLUDED.refresh_24h_delta_likes,
      refresh_24h_delta_reposts = EXCLUDED.refresh_24h_delta_reposts,
      refresh_24h_delta_replies = EXCLUDED.refresh_24h_delta_replies,
      refresh_24h_delta_views = EXCLUDED.refresh_24h_delta_views,
      discovered_at = EXCLUDED.discovered_at,
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = now()
    RETURNING (xmax = 0) AS inserted
  `;

  for (const [index, item] of items.entries()) {
    const authorHandle = normalizeHandle(item.author_handle);
    if (shouldOmitKeywordOriginPost(item, authorHandle, omitHandles)) {
      result.errors.push({ index, message: `omitted keyword-origin author handle: ${authorHandle}` });
      result.skipped += 1;
      continue;
    }

    try {
      const inserted = await runUpsert(sql, [
        item.status_id,
        item.url,
        authorHandle,
        item.author_display || null,
        item.body_text || null,
        item.posted_relative || null,
        item.source_query || null,
        item.watch_tier || null,
        item.is_significant ?? false,
        item.significance_reason || null,
        item.significance_version || "v1",
        item.likes ?? 0,
        item.reposts ?? 0,
        item.replies ?? 0,
        item.views ?? 0,
        item.initial_likes ?? null,
        item.initial_reposts ?? null,
        item.initial_replies ?? null,
        item.initial_views ?? null,
        item.likes_24h ?? null,
        item.reposts_24h ?? null,
        item.replies_24h ?? null,
        item.views_24h ?? null,
        item.refresh_24h_at || null,
        item.refresh_24h_status || null,
        item.refresh_24h_delta_likes ?? null,
        item.refresh_24h_delta_reposts ?? null,
        item.refresh_24h_delta_replies ?? null,
        item.refresh_24h_delta_views ?? null,
        item.discovered_at,
        item.last_seen_at,
      ]);

      if (inserted.inserted) {
        result.inserted += 1;
      } else {
        result.updated += 1;
      }
    } catch (error) {
      result.errors.push({ index, message: errorMessage(error) });
      result.skipped += 1;
    }
  }

  return result;
}

async function purgePostsByAuthorHandle(authorHandle) {
  const normalizedHandle = normalizeHandle(authorHandle);
  const db = getPool();
  const result = await db.query(
    `
      DELETE FROM posts
      WHERE lower(author_handle) = $1
    `,
    [normalizedHandle]
  );

  return {
    author_handle: normalizedHandle,
    deleted: result.rowCount ?? 0,
  };
}

async function upsertMetricSnapshots(items) {
  const result = buildBatchResult(items.length);
  const sql = `
    INSERT INTO post_metrics_snapshots(status_id, snapshot_type, snapshot_at, likes, reposts, replies, views, source)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (status_id, snapshot_type, snapshot_at) DO UPDATE SET
      likes = EXCLUDED.likes,
      reposts = EXCLUDED.reposts,
      replies = EXCLUDED.replies,
      views = EXCLUDED.views,
      source = EXCLUDED.source
    RETURNING (xmax = 0) AS inserted
  `;

  for (const [index, item] of items.entries()) {
    try {
      const inserted = await runUpsert(sql, [
        item.status_id,
        item.snapshot_type,
        item.snapshot_at,
        item.likes,
        item.reposts,
        item.replies,
        item.views,
        item.source || "ingest",
      ]);

      if (inserted.inserted) {
        result.inserted += 1;
      } else {
        result.updated += 1;
      }
    } catch (error) {
      result.errors.push({ index, message: errorMessage(error) });
      result.skipped += 1;
    }
  }

  return result;
}

async function upsertReports(items) {
  const result = buildBatchResult(items.length);
  const sql = `
    INSERT INTO reports(status_id, reported_at, channel, destination, summary)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (status_id) DO UPDATE SET
      reported_at = EXCLUDED.reported_at,
      channel = EXCLUDED.channel,
      destination = EXCLUDED.destination,
      summary = EXCLUDED.summary
    RETURNING (xmax = 0) AS inserted
  `;

  for (const [index, item] of items.entries()) {
    try {
      const inserted = await runUpsert(sql, [
        item.status_id,
        item.reported_at,
        item.channel || null,
        item.destination || null,
        item.summary || null,
      ]);

      if (inserted.inserted) {
        result.inserted += 1;
      } else {
        result.updated += 1;
      }
    } catch (error) {
      result.errors.push({ index, message: errorMessage(error) });
      result.skipped += 1;
    }
  }

  return result;
}

async function upsertPipelineRun(item) {
  const result = buildBatchResult(1);
  const sql = `
    INSERT INTO pipeline_runs(run_at, mode, fetched_count, significant_count, reported_count, note, source)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (run_at, mode, source) DO UPDATE SET
      fetched_count = EXCLUDED.fetched_count,
      significant_count = EXCLUDED.significant_count,
      reported_count = EXCLUDED.reported_count,
      note = EXCLUDED.note
    RETURNING (xmax = 0) AS inserted
  `;

  try {
    const inserted = await runUpsert(sql, [
      item.run_at,
      item.mode,
      item.fetched_count ?? 0,
      item.significant_count ?? 0,
      item.reported_count ?? 0,
      item.note || null,
      item.source || "local-dispatcher",
    ]);

    if (inserted.inserted) {
      result.inserted = 1;
    } else {
      result.updated = 1;
    }
  } catch (error) {
    result.errors.push({ index: 0, message: errorMessage(error) });
    result.skipped = 1;
  }

  return result;
}

async function upsertWindowSummaries(items) {
  await ensureSummaryAnalyticsSchema();

  const result = buildBatchResult(items.length);
  const sql = `
    INSERT INTO window_summaries(
      summary_key,
      window_type,
      window_start,
      window_end,
      generated_at,
      post_count,
      significant_count,
      tier_counts_json,
      top_themes_json,
      debates_json,
      top_authors_json,
      notable_posts_json,
      summary_text,
      source_version,
      embedding_backend,
      embedding_model,
      embedding_dims,
      embedding_vector_json,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
      $13, $14, $15, $16, $17, $18::jsonb, $19, $20
    )
    ON CONFLICT (summary_key) DO UPDATE SET
      window_type = EXCLUDED.window_type,
      window_start = EXCLUDED.window_start,
      window_end = EXCLUDED.window_end,
      generated_at = EXCLUDED.generated_at,
      post_count = EXCLUDED.post_count,
      significant_count = EXCLUDED.significant_count,
      tier_counts_json = EXCLUDED.tier_counts_json,
      top_themes_json = EXCLUDED.top_themes_json,
      debates_json = EXCLUDED.debates_json,
      top_authors_json = EXCLUDED.top_authors_json,
      notable_posts_json = EXCLUDED.notable_posts_json,
      summary_text = EXCLUDED.summary_text,
      source_version = EXCLUDED.source_version,
      embedding_backend = EXCLUDED.embedding_backend,
      embedding_model = EXCLUDED.embedding_model,
      embedding_dims = EXCLUDED.embedding_dims,
      embedding_vector_json = EXCLUDED.embedding_vector_json,
      updated_at = COALESCE(EXCLUDED.updated_at, now())
    RETURNING (xmax = 0) AS inserted
  `;

  for (const [index, item] of items.entries()) {
    try {
      const inserted = await runUpsert(sql, [
        item.summary_key,
        item.window_type,
        item.window_start,
        item.window_end,
        item.generated_at,
        item.post_count ?? 0,
        item.significant_count ?? 0,
        asJson(item.tier_counts ?? {}),
        asJson(item.top_themes ?? []),
        asJson(item.debates ?? []),
        asJson(item.top_authors ?? []),
        asJson(item.notable_posts ?? []),
        item.summary_text,
        item.source_version ?? "v1",
        item.embedding_backend ?? null,
        item.embedding_model ?? null,
        item.embedding_dims ?? null,
        asJson(item.embedding_vector ?? null),
        item.created_at || item.generated_at,
        item.updated_at || item.generated_at,
      ]);

      if (inserted.inserted) {
        result.inserted += 1;
      } else {
        result.updated += 1;
      }
    } catch (error) {
      result.errors.push({ index, message: errorMessage(error) });
      result.skipped += 1;
    }
  }

  return result;
}

async function upsertNarrativeShifts(items) {
  await ensureSummaryAnalyticsSchema();

  const result = buildBatchResult(items.length);
  const sql = `
    INSERT INTO narrative_shifts(
      shift_key,
      basis_window_type,
      period_start,
      period_end,
      generated_at,
      source_summary_keys_json,
      emerging_themes_json,
      declining_themes_json,
      debate_intensity_json,
      position_shifts_json,
      summary_text,
      source_version,
      embedding_backend,
      embedding_model,
      embedding_dims,
      embedding_vector_json,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb,
      $11, $12, $13, $14, $15, $16::jsonb, $17, $18
    )
    ON CONFLICT (shift_key) DO UPDATE SET
      basis_window_type = EXCLUDED.basis_window_type,
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      generated_at = EXCLUDED.generated_at,
      source_summary_keys_json = EXCLUDED.source_summary_keys_json,
      emerging_themes_json = EXCLUDED.emerging_themes_json,
      declining_themes_json = EXCLUDED.declining_themes_json,
      debate_intensity_json = EXCLUDED.debate_intensity_json,
      position_shifts_json = EXCLUDED.position_shifts_json,
      summary_text = EXCLUDED.summary_text,
      source_version = EXCLUDED.source_version,
      embedding_backend = EXCLUDED.embedding_backend,
      embedding_model = EXCLUDED.embedding_model,
      embedding_dims = EXCLUDED.embedding_dims,
      embedding_vector_json = EXCLUDED.embedding_vector_json,
      updated_at = COALESCE(EXCLUDED.updated_at, now())
    RETURNING (xmax = 0) AS inserted
  `;

  for (const [index, item] of items.entries()) {
    try {
      const inserted = await runUpsert(sql, [
        item.shift_key,
        item.basis_window_type,
        item.period_start,
        item.period_end,
        item.generated_at,
        asJson(item.source_summary_keys ?? []),
        asJson(item.emerging_themes ?? []),
        asJson(item.declining_themes ?? []),
        asJson(item.debate_intensity ?? []),
        asJson(item.position_shifts ?? {}),
        item.summary_text,
        item.source_version ?? "v1",
        item.embedding_backend ?? null,
        item.embedding_model ?? null,
        item.embedding_dims ?? null,
        asJson(item.embedding_vector ?? null),
        item.created_at || item.generated_at,
        item.updated_at || item.generated_at,
      ]);

      if (inserted.inserted) {
        result.inserted += 1;
      } else {
        result.updated += 1;
      }
    } catch (error) {
      result.errors.push({ index, message: errorMessage(error) });
      result.skipped += 1;
    }
  }

  return result;
}

async function upsertEmbeddings(items) {
  const result = buildBatchResult(items.length);
  const sql = `
    INSERT INTO embeddings(
      status_id,
      backend,
      model,
      dims,
      vector_json,
      embedding,
      text_hash,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5::jsonb, ($6)::vector, $7, $8, $9
    )
    ON CONFLICT (status_id) DO UPDATE SET
      backend = EXCLUDED.backend,
      model = EXCLUDED.model,
      dims = EXCLUDED.dims,
      vector_json = EXCLUDED.vector_json,
      embedding = EXCLUDED.embedding,
      text_hash = EXCLUDED.text_hash,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at
    RETURNING (xmax = 0) AS inserted
  `;

  for (const [index, item] of items.entries()) {
    try {
      const inserted = await runUpsert(sql, [
        item.status_id,
        item.backend,
        item.model,
        item.dims,
        asJson(item.vector),
        vectorLiteral(item.vector),
        item.text_hash,
        item.created_at,
        item.updated_at,
      ]);

      if (inserted.inserted) {
        result.inserted += 1;
      } else {
        result.updated += 1;
      }
    } catch (error) {
      result.errors.push({ index, message: errorMessage(error) });
      result.skipped += 1;
    }
  }

  return result;
}

async function createQueryEmbedding(queryText) {
  const apiKey = embeddingApiKey();
  if (!apiKey) {
    throw new Error("embedding API key is not configured. Set XMONITOR_EMBEDDING_API_KEY.");
  }

  const endpoint = `${embeddingBaseUrl()}/embeddings`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), embeddingTimeoutMs());

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: embeddingModel(),
        input: queryText,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        // ignore
      }
      const snippet = (detail || "").trim().split("\n")[0]?.slice(0, 240);
      throw new Error(`embedding request failed (${response.status})${snippet ? `: ${snippet}` : ""}`);
    }

    const payload = await response.json();
    const vector = payload?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("embedding response missing data[0].embedding");
    }

    const parsed = vector.map((value) => Number(value));
    if (parsed.some((value) => !Number.isFinite(value))) {
      throw new Error("embedding vector contains non-numeric values");
    }

    return parsed;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function querySemanticFeed(query, embeddingVector) {
  const db = getPool();
  const dims = embeddingDims();
  if (!Array.isArray(embeddingVector) || embeddingVector.length !== dims) {
    throw new Error(`embedding dimension mismatch: expected ${dims}, got ${embeddingVector?.length || 0}`);
  }

  const where = [];
  const params = [];
  const vectorParam = vectorLiteral(embeddingVector);
  params.push(vectorParam);
  params.push(dims);
  params.push(embeddingModel());

  if (query.since) {
    params.push(query.since);
    where.push(`p.discovered_at >= $${params.length}`);
  }

  if (query.until) {
    params.push(query.until);
    where.push(`p.discovered_at <= $${params.length}`);
  }

  if (query.tier) {
    params.push(query.tier);
    where.push(`p.watch_tier = $${params.length}`);
  }

  if (query.handle) {
    const handles = parseHandleFilter(query.handle);
    if (handles.length === 1) {
      params.push(handles[0]);
      where.push(`p.author_handle = $${params.length}`);
    } else if (handles.length > 1) {
      params.push(handles);
      where.push(`p.author_handle = ANY($${params.length}::text[])`);
    }
  }

  if (query.significant !== undefined) {
    params.push(query.significant);
    where.push(`p.is_significant = $${params.length}`);
  }

  const requestedLimit = query.limit || semanticDefaultLimit();
  const finalLimit = Math.min(Math.max(requestedLimit, 1), semanticMaxLimit());
  const retrievalLimit = Math.min(finalLimit * semanticRetrievalFactor(), semanticMaxLimit() * 5);

  params.push(retrievalLimit);
  const retrievalLimitParam = params.length;

  params.push(finalLimit);
  const finalLimitParam = params.length;

  params.push(Number.isFinite(query.min_score) ? query.min_score : semanticMinScore());
  const minScoreParam = params.length;

  const postFilters = [...where, `c.score >= $${minScoreParam}`];
  const whereClause = `WHERE ${postFilters.join(" AND ")}`;
  const dimLiteral = Math.max(1, dims);
  const sql = `
    WITH semantic_candidates AS (
      SELECT
        e.status_id,
        1 - ((e.embedding::vector(${dimLiteral})) <=> ($1::vector(${dimLiteral}))) AS score
      FROM embeddings e
      WHERE e.embedding IS NOT NULL
        AND e.dims = $2
        AND e.model = $3
      ORDER BY (e.embedding::vector(${dimLiteral})) <=> ($1::vector(${dimLiteral})) ASC
      LIMIT $${retrievalLimitParam}
    )
    SELECT
      p.status_id,
      p.discovered_at,
      p.author_handle,
      p.watch_tier,
      p.body_text,
      p.url,
      p.is_significant,
      p.significance_reason,
      p.likes,
      p.reposts,
      p.replies,
      p.views,
      r.reported_at,
      c.score
    FROM semantic_candidates c
    JOIN posts p ON p.status_id = c.status_id
    LEFT JOIN reports r ON r.status_id = p.status_id
    ${whereClause}
    ORDER BY c.score DESC, p.discovered_at DESC, p.status_id DESC
    LIMIT $${finalLimitParam}
  `;

  const result = await db.query(sql, params);
  return {
    items: result.rows.map(rowToFeedItem),
    model: embeddingModel(),
    retrieved_count: result.rows.length,
  };
}

function addStandardPostFilters(query, params, where, postAlias) {
  if (query.since) {
    params.push(query.since);
    where.push(`${postAlias}.discovered_at >= $${params.length}`);
  }

  if (query.until) {
    params.push(query.until);
    where.push(`${postAlias}.discovered_at <= $${params.length}`);
  }

  if (query.tier) {
    params.push(query.tier);
    where.push(`${postAlias}.watch_tier = $${params.length}`);
  }

  if (query.handle) {
    const handles = parseHandleFilter(query.handle);
    if (handles.length === 1) {
      params.push(handles[0]);
      where.push(`${postAlias}.author_handle = $${params.length}`);
    } else if (handles.length > 1) {
      params.push(handles);
      where.push(`${postAlias}.author_handle = ANY($${params.length}::text[])`);
    }
  }

  if (query.significant !== undefined) {
    params.push(query.significant);
    where.push(`${postAlias}.is_significant = $${params.length}`);
  }
}

function buildLexicalPatterns(taskText) {
  const full = asString(taskText);
  if (!full) return [];

  const tokens = String(full)
    .toLowerCase()
    .split(/[^a-z0-9_@#]+/g)
    .map((item) => item.trim().replace(/^[@#]+/, ""))
    .filter((item) => item.length >= 3);

  const unique = [];
  const seen = new Set();
  const seed = [full.toLowerCase(), ...tokens];
  for (const item of seed) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(`%${key}%`);
    if (unique.length >= 9) break;
  }

  return unique;
}

function buildCitationExcerpt(bodyText) {
  const raw = asString(bodyText) || "(no text captured)";
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= 220) return normalized;
  return `${normalized.slice(0, 217)}...`;
}

async function queryComposeEvidence(query, embeddingVector) {
  const startedAt = Date.now();
  const db = getPool();
  const dims = embeddingDims();
  if (!Array.isArray(embeddingVector) || embeddingVector.length !== dims) {
    throw new Error(`embedding dimension mismatch: expected ${dims}, got ${embeddingVector?.length || 0}`);
  }

  const retrievalLimit = Math.min(Math.max(query.retrieval_limit || composeDefaultRetrievalLimit(), 1), composeMaxRetrievalLimit());
  const contextLimit = Math.min(
    Math.max(query.context_limit || composeDefaultContextLimit(), 1),
    composeMaxContextLimit(),
    retrievalLimit
  );
  const semanticCandidateLimit = Math.max(retrievalLimit, contextLimit);

  const semanticParams = [vectorLiteral(embeddingVector), dims, embeddingModel()];
  const semanticWhere = [];
  addStandardPostFilters(query, semanticParams, semanticWhere, "p");

  semanticParams.push(semanticCandidateLimit);
  const semanticLimitParam = semanticParams.length;

  semanticParams.push(semanticMinScore());
  const semanticMinScoreParam = semanticParams.length;

  const semanticFilters = [...semanticWhere, `c.score >= $${semanticMinScoreParam}`];
  const semanticWhereClause = semanticFilters.length > 0 ? `WHERE ${semanticFilters.join(" AND ")}` : "";
  const dimLiteral = Math.max(1, dims);
  const semanticSql = `
    WITH semantic_candidates AS (
      SELECT
        e.status_id,
        1 - ((e.embedding::vector(${dimLiteral})) <=> ($1::vector(${dimLiteral}))) AS score
      FROM embeddings e
      WHERE e.embedding IS NOT NULL
        AND e.dims = $2
        AND e.model = $3
      ORDER BY (e.embedding::vector(${dimLiteral})) <=> ($1::vector(${dimLiteral})) ASC
      LIMIT $${semanticLimitParam}
    )
    SELECT
      p.status_id,
      p.discovered_at,
      p.author_handle,
      p.watch_tier,
      p.body_text,
      p.url,
      p.is_significant,
      p.significance_reason,
      p.likes,
      p.reposts,
      p.replies,
      p.views,
      r.reported_at,
      c.score
    FROM semantic_candidates c
    JOIN posts p ON p.status_id = c.status_id
    LEFT JOIN reports r ON r.status_id = p.status_id
    ${semanticWhereClause}
    ORDER BY c.score DESC, p.discovered_at DESC, p.status_id DESC
  `;

  const semanticResult = await db.query(semanticSql, semanticParams);
  const semanticItems = semanticResult.rows.map(rowToFeedItem);

  const deduped = [];
  const seenStatusIds = new Set();
  for (const item of semanticItems) {
    if (seenStatusIds.has(item.status_id)) continue;
    seenStatusIds.add(item.status_id);
    deduped.push(item);
    if (deduped.length >= retrievalLimit) break;
  }

  if (deduped.length < contextLimit) {
    const patterns = buildLexicalPatterns(query.task_text);
    if (patterns.length > 0) {
      const lexicalWhere = [];
      const lexicalParams = [];
      addStandardPostFilters(query, lexicalParams, lexicalWhere, "p");

      lexicalParams.push(patterns);
      lexicalWhere.push(`(p.body_text ILIKE ANY($${lexicalParams.length}::text[]) OR p.author_handle::text ILIKE ANY($${lexicalParams.length}::text[]))`);

      if (seenStatusIds.size > 0) {
        lexicalParams.push(Array.from(seenStatusIds));
        lexicalWhere.push(`p.status_id <> ALL($${lexicalParams.length}::text[])`);
      }

      const lexicalLimit = Math.max((contextLimit - deduped.length) * 2, 8);
      lexicalParams.push(lexicalLimit);
      const lexicalLimitParam = lexicalParams.length;
      const lexicalWhereClause = lexicalWhere.length > 0 ? `WHERE ${lexicalWhere.join(" AND ")}` : "";

      const lexicalSql = `
        SELECT
          p.status_id,
          p.discovered_at,
          p.author_handle,
          p.watch_tier,
          p.body_text,
          p.url,
          p.is_significant,
          p.significance_reason,
          p.likes,
          p.reposts,
          p.replies,
          p.views,
          r.reported_at,
          NULL::double precision AS score
        FROM posts p
        LEFT JOIN reports r ON r.status_id = p.status_id
        ${lexicalWhereClause}
        ORDER BY p.discovered_at DESC, p.status_id DESC
        LIMIT $${lexicalLimitParam}
      `;

      const lexicalResult = await db.query(lexicalSql, lexicalParams);
      const lexicalItems = lexicalResult.rows.map(rowToFeedItem);

      for (const item of lexicalItems) {
        if (seenStatusIds.has(item.status_id)) continue;
        seenStatusIds.add(item.status_id);
        deduped.push(item);
        if (deduped.length >= retrievalLimit) break;
      }
    }
  }

  const evidenceItems = deduped.slice(0, contextLimit);
  const citations = evidenceItems.map((item) => ({
    status_id: item.status_id,
    url: item.url,
    author_handle: item.author_handle,
    excerpt: buildCitationExcerpt(item.body_text),
    score: item.score !== undefined ? item.score : null,
  }));

  const keyPoints = evidenceItems.slice(0, 5).map((item) => {
    const excerpt = buildCitationExcerpt(item.body_text);
    return `@${item.author_handle}: ${excerpt}`;
  });

  const answerText = evidenceItems.length
    ? `Retrieved ${evidenceItems.length} relevant posts for this task. Evidence is attached with citations; AI synthesis is added in WS3.`
    : "No sufficiently relevant posts found for this task in the selected scope.";

  const coverage = contextLimit > 0 ? Number((evidenceItems.length / contextLimit).toFixed(3)) : null;

  return {
    answer_text: answerText,
    draft_text: null,
    key_points: keyPoints,
    citations,
    retrieval_stats: {
      retrieved_count: deduped.length,
      used_count: evidenceItems.length,
      model: embeddingModel(),
      latency_ms: Date.now() - startedAt,
      coverage_score: coverage,
    },
  };
}

async function getFeed(query) {
  const db = getPool();
  const where = [];
  const params = [];

  if (query.since) {
    params.push(query.since);
    where.push(`p.discovered_at >= $${params.length}`);
  }

  if (query.until) {
    params.push(query.until);
    where.push(`p.discovered_at <= $${params.length}`);
  }

  if (query.tier) {
    params.push(query.tier);
    where.push(`p.watch_tier = $${params.length}`);
  }

  if (query.handle) {
    const handles = parseHandleFilter(query.handle);

    if (handles.length === 1) {
      params.push(handles[0]);
      where.push(`p.author_handle = $${params.length}`);
    } else if (handles.length > 1) {
      params.push(handles);
      where.push(`p.author_handle = ANY($${params.length}::text[])`);
    }
  }

  if (query.significant !== undefined) {
    params.push(query.significant);
    where.push(`p.is_significant = $${params.length}`);
  }

  if (query.q) {
    params.push(`%${query.q}%`);
    where.push(`(
      p.body_text ILIKE $${params.length}
      OR p.author_handle::text ILIKE $${params.length}
    )`);
  }

  if (query.cursor) {
    const decoded = decodeFeedCursor(query.cursor);
    if (decoded) {
      params.push(decoded.discovered_at);
      params.push(decoded.status_id);
      where.push(`(p.discovered_at, p.status_id) < ($${params.length - 1}, $${params.length})`);
    }
  }

  const limit = Math.min(Math.max(query.limit || defaultFeedLimit(), 1), maxFeedLimit());
  params.push(limit + 1);

  const sql = `
    SELECT
      p.status_id,
      p.discovered_at,
      p.author_handle,
      p.watch_tier,
      p.body_text,
      p.url,
      p.is_significant,
      p.significance_reason,
      p.likes,
      p.reposts,
      p.replies,
      p.views,
      r.reported_at
    FROM posts p
    LEFT JOIN reports r ON r.status_id = p.status_id
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY p.discovered_at DESC, p.status_id DESC
    LIMIT $${params.length}
  `;

  const rows = await db.query(sql, params);
  const hasMore = rows.rows.length > limit;
  const sliced = hasMore ? rows.rows.slice(0, limit) : rows.rows;
  const items = sliced.map(rowToFeedItem);

  let nextCursor = null;
  if (hasMore && items.length > 0) {
    const tail = items[items.length - 1];
    nextCursor = encodeFeedCursor({ discovered_at: tail.discovered_at, status_id: tail.status_id });
  }

  return { items, next_cursor: nextCursor };
}

async function getLatestWindowSummaries() {
  const db = getPool();
  const result = await db.query(
    `
      WITH requested(window_type, ord) AS (
        VALUES ('rolling_2h'::text, 1), ('rolling_12h'::text, 2)
      )
      SELECT
        ws.summary_key,
        ws.window_type,
        ws.window_start,
        ws.window_end,
        ws.generated_at,
        ws.post_count,
        ws.significant_count,
        ws.summary_text
      FROM requested r
      LEFT JOIN LATERAL (
        SELECT
          summary_key,
          window_type,
          window_start,
          window_end,
          generated_at,
          post_count,
          significant_count,
          summary_text
        FROM window_summaries
        WHERE window_type = r.window_type
          AND summary_key LIKE (r.window_type || ':%')
        ORDER BY window_end DESC, generated_at DESC
        LIMIT 1
      ) ws ON true
      ORDER BY r.ord
    `
  );

  return result.rows.filter((row) => row.summary_key).map(rowToWindowSummary);
}

async function getPostDetail(statusId) {
  const db = getPool();
  const postResult = await db.query(
    `
      SELECT
        p.status_id,
        p.discovered_at,
        p.author_handle,
        p.watch_tier,
        p.body_text,
        p.url,
        p.is_significant,
        p.significance_reason,
        p.likes,
        p.reposts,
        p.replies,
        p.views,
        r.reported_at,
        r.channel,
        r.destination,
        r.summary
      FROM posts p
      LEFT JOIN reports r ON r.status_id = p.status_id
      WHERE p.status_id = $1
      LIMIT 1
    `,
    [statusId]
  );

  if (postResult.rowCount === 0) {
    return null;
  }

  const postRow = postResult.rows[0];

  const snapshotsResult = await db.query(
    `
      SELECT status_id, snapshot_type, snapshot_at, likes, reposts, replies, views, source
      FROM post_metrics_snapshots
      WHERE status_id = $1
      ORDER BY snapshot_at DESC
    `,
    [statusId]
  );

  const report = postRow.reported_at
    ? {
        status_id: statusId,
        reported_at: toIso(postRow.reported_at) || new Date(0).toISOString(),
        channel: postRow.channel ? String(postRow.channel) : null,
        destination: postRow.destination ? String(postRow.destination) : null,
        summary: postRow.summary ? String(postRow.summary) : null,
      }
    : null;

  return {
    post: rowToFeedItem(postRow),
    snapshots: snapshotsResult.rows.map((row) => ({
      status_id: String(row.status_id),
      snapshot_type: row.snapshot_type,
      snapshot_at: toIso(row.snapshot_at) || new Date(0).toISOString(),
      likes: Number(row.likes || 0),
      reposts: Number(row.reposts || 0),
      replies: Number(row.replies || 0),
      views: Number(row.views || 0),
      source: row.source ? String(row.source) : "ingest",
    })),
    report,
  };
}

async function getReconcileCounts(since) {
  const db = getPool();
  const result = await db.query(
    `
      SELECT
        (SELECT COUNT(*)
         FROM posts p
         WHERE p.discovered_at >= $1
            OR p.last_seen_at >= $1
            OR (p.refresh_24h_at IS NOT NULL AND p.refresh_24h_at >= $1)) AS posts,
        (SELECT COUNT(*) FROM reports r WHERE r.reported_at >= $1) AS reports,
        (SELECT COUNT(*) FROM pipeline_runs pr WHERE pr.run_at >= $1) AS pipeline_runs,
        (SELECT COUNT(*) FROM window_summaries ws WHERE ws.generated_at >= $1) AS window_summaries,
        (SELECT COUNT(*) FROM narrative_shifts ns WHERE ns.generated_at >= $1) AS narrative_shifts
    `,
    [since]
  );

  const row = result.rows[0] || {};
  return {
    since,
    generated_at: new Date().toISOString(),
    counts: {
      posts: Number(row.posts || 0),
      reports: Number(row.reports || 0),
      pipeline_runs: Number(row.pipeline_runs || 0),
      window_summaries: Number(row.window_summaries || 0),
      narrative_shifts: Number(row.narrative_shifts || 0),
    },
  };
}

async function handleHealth() {
  const dbConfigured = hasDatabaseConfig();
  let database = "not_configured";

  if (dbConfigured) {
    try {
      await getPool().query("SELECT 1");
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

async function handleFeed(event) {
  if (!hasDatabaseConfig()) {
    return jsonError("Database is not configured. Set DATABASE_URL or PG* variables.", 503);
  }

  const input = {};
  const params = event?.queryStringParameters || {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && input[key] === undefined) {
      input[key] = value;
    }
  }

  const query = parseFeedQuery(input);

  try {
    const feed = await getFeed(query);
    return jsonOk(feed);
  } catch (error) {
    return jsonError(errorMessage(error) || "failed to query feed", 503);
  }
}

async function handleSemanticQuery(event) {
  if (!semanticEnabled()) {
    return jsonError("semantic query is disabled", 503);
  }

  if (!hasDatabaseConfig()) {
    return jsonError("Database is not configured. Set DATABASE_URL or PG* variables.", 503);
  }

  const parsedBody = readJsonBody(event);
  if (!parsedBody.ok) {
    return jsonError(parsedBody.error, 400);
  }

  const parsedQuery = parseSemanticQueryBody(parsedBody.body);
  if (!parsedQuery.ok) {
    return jsonError(parsedQuery.error, 400);
  }

  try {
    const queryEmbedding = parsedQuery.data.query_vector || await createQueryEmbedding(parsedQuery.data.query_text);
    const payload = await querySemanticFeed(parsedQuery.data, queryEmbedding);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(errorMessage(error) || "failed to execute semantic query", 503);
  }
}

async function handleComposeQuery(event) {
  if (!composeEnabled()) {
    return jsonError("compose query is disabled", 503);
  }

  if (!hasDatabaseConfig()) {
    return jsonError("Database is not configured. Set DATABASE_URL or PG* variables.", 503);
  }

  const parsedBody = readJsonBody(event);
  if (!parsedBody.ok) {
    return jsonError(parsedBody.error, 400);
  }

  const parsedQuery = parseComposeQueryBody(parsedBody.body);
  if (!parsedQuery.ok) {
    return jsonError(parsedQuery.error, 400);
  }

  try {
    const queryEmbedding = parsedQuery.data.query_vector || await createQueryEmbedding(parsedQuery.data.task_text);
    const payload = await queryComposeEvidence(parsedQuery.data, queryEmbedding);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(errorMessage(error) || "failed to execute compose query", 503);
  }
}

async function handleWindowSummariesLatest() {
  if (!hasDatabaseConfig()) {
    return jsonError("Database is not configured. Set DATABASE_URL or PG* variables.", 503);
  }

  try {
    const items = await getLatestWindowSummaries();
    return jsonOk({ items });
  } catch (error) {
    return jsonError(errorMessage(error) || "failed to query latest window summaries", 503);
  }
}

async function handlePostDetail(path) {
  if (!hasDatabaseConfig()) {
    return jsonError("Database is not configured. Set DATABASE_URL or PG* variables.", 503);
  }

  const match = path.match(/^\/v1\/posts\/([^/]+)$/);
  const statusId = match ? decodeURIComponent(match[1]) : "";
  if (!statusId) {
    return jsonError("statusId is required", 400);
  }

  try {
    const detail = await getPostDetail(statusId);
    if (!detail) {
      return jsonError("not found", 404);
    }
    return jsonOk(detail);
  } catch (error) {
    return jsonError(errorMessage(error) || "failed to query post detail", 503);
  }
}

async function handleOpsReconcileCounts(event) {
  if (!hasDatabaseConfig()) {
    return jsonError("Database is not configured. Set DATABASE_URL or PG* variables.", 503);
  }

  const params = event?.queryStringParameters || {};
  const since = parseSinceIso(params.since);
  if (!since) {
    return jsonError("invalid since parameter (expected ISO-8601 timestamp)", 400);
  }

  try {
    const payload = await getReconcileCounts(since);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(errorMessage(error) || "failed to compute reconciliation counts", 503);
  }
}

async function handleOpsPurgeHandle(event) {
  if (!hasDatabaseConfig()) {
    return jsonError("Database is not configured. Set DATABASE_URL or PG* variables.", 503);
  }

  const parsedBody = readJsonBody(event);
  if (!parsedBody.ok) {
    return jsonError(parsedBody.error, 400);
  }

  const payload = asObject(parsedBody.body);
  const handle = asString(payload?.author_handle ?? payload?.handle);
  if (!handle) {
    return jsonError("author_handle is required", 400);
  }

  try {
    const result = await purgePostsByAuthorHandle(handle);
    return jsonOk({
      author_handle: result.author_handle,
      deleted: result.deleted,
      purged_at: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(errorMessage(error) || "failed to purge posts", 503);
  }
}

async function handleIngestBatch(event, parser, upsertFn, dbErrorMessage) {
  if (!hasDatabaseConfig()) {
    return jsonError("Database is not configured. Set DATABASE_URL or PG* variables.", 503);
  }

  const parsedBody = readJsonBody(event);
  if (!parsedBody.ok) {
    return jsonError(parsedBody.error, 400);
  }

  const parsedBatch = parseBatchItems(parsedBody.body);
  if (!parsedBatch.ok) {
    return jsonError(parsedBatch.error, 400);
  }

  const received = parsedBatch.items.length;
  const validItems = [];
  const validIndices = [];
  const baseResult = buildBatchResult(received);

  parsedBatch.items.forEach((item, index) => {
    const parsed = parser(item);
    if (!parsed.ok) {
      baseResult.skipped += 1;
      baseResult.errors.push({ index, message: parsed.error });
      return;
    }
    validItems.push(parsed.data);
    validIndices.push(index);
  });

  if (validItems.length === 0) {
    return jsonOk(baseResult);
  }

  try {
    const dbResult = await upsertFn(validItems);
    return jsonOk({
      received: baseResult.received,
      inserted: dbResult.inserted,
      updated: dbResult.updated,
      skipped: baseResult.skipped + dbResult.skipped,
      errors: [
        ...baseResult.errors,
        ...dbResult.errors.map((error) => ({
          index: validIndices[error.index] ?? error.index,
          message: error.message,
        })),
      ],
    });
  } catch (error) {
    return jsonError(errorMessage(error) || dbErrorMessage, 503);
  }
}

async function handleIngestRuns(event) {
  if (!hasDatabaseConfig()) {
    return jsonError("Database is not configured. Set DATABASE_URL or PG* variables.", 503);
  }

  const parsedBody = readJsonBody(event);
  if (!parsedBody.ok) {
    return jsonError(parsedBody.error, 400);
  }

  const parsed = parsePipelineRunUpsert(parsedBody.body);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  try {
    const result = await upsertPipelineRun(parsed.data);
    return jsonOk(result);
  } catch (error) {
    return jsonError(errorMessage(error) || "failed to upsert pipeline run", 503);
  }
}

export async function handler(event) {
  const method = String(event?.requestContext?.http?.method || event?.httpMethod || "GET").toUpperCase();
  const path = normalizePath(event?.rawPath || event?.path || "/");

  if (method === "POST" && isIngestPath(path)) {
    const auth = validateIngestAuthorization(event);
    if (!auth.ok) {
      return jsonError(auth.error, auth.status);
    }
  }

  if ((method === "GET" || method === "POST") && isOpsPath(path)) {
    const auth = validateIngestAuthorization(event);
    if (!auth.ok) {
      return jsonError(auth.error, auth.status);
    }
  }

  if (method === "GET" && path === "/v1/health") {
    return handleHealth();
  }

  if (method === "GET" && path === "/v1/feed") {
    return handleFeed(event);
  }

  if (method === "POST" && path === "/v1/query/semantic") {
    return handleSemanticQuery(event);
  }

  if (method === "POST" && path === "/v1/query/compose") {
    return handleComposeQuery(event);
  }

  if (method === "GET" && path === "/v1/window-summaries/latest") {
    return handleWindowSummariesLatest();
  }

  if (method === "GET" && /^\/v1\/posts\/[^/]+$/.test(path)) {
    return handlePostDetail(path);
  }

  if (method === "GET" && path === "/v1/ops/reconcile-counts") {
    return handleOpsReconcileCounts(event);
  }

  if (method === "POST" && path === "/v1/ops/purge-handle") {
    return handleOpsPurgeHandle(event);
  }

  if (method === "POST" && path === "/v1/ingest/posts/batch") {
    return handleIngestBatch(
      event,
      parsePostUpsert,
      upsertPosts,
      "failed to upsert posts"
    );
  }

  if (method === "POST" && path === "/v1/ingest/metrics/batch") {
    return handleIngestBatch(
      event,
      parseMetricsSnapshotUpsert,
      upsertMetricSnapshots,
      "failed to upsert metric snapshots"
    );
  }

  if (method === "POST" && path === "/v1/ingest/reports/batch") {
    return handleIngestBatch(
      event,
      parseReportUpsert,
      upsertReports,
      "failed to upsert reports"
    );
  }

  if (method === "POST" && path === "/v1/ingest/window-summaries/batch") {
    return handleIngestBatch(
      event,
      parseWindowSummaryUpsert,
      upsertWindowSummaries,
      "failed to upsert window summaries"
    );
  }

  if (method === "POST" && path === "/v1/ingest/narrative-shifts/batch") {
    return handleIngestBatch(
      event,
      parseNarrativeShiftUpsert,
      upsertNarrativeShifts,
      "failed to upsert narrative shifts"
    );
  }

  if (method === "POST" && path === "/v1/ingest/embeddings/batch") {
    return handleIngestBatch(
      event,
      parseEmbeddingUpsert,
      upsertEmbeddings,
      "failed to upsert embeddings"
    );
  }

  if (method === "POST" && path === "/v1/ingest/runs") {
    return handleIngestRuns(event);
  }

  return jsonError("not found", 404);
}
