import {
  COMPOSE_ANSWER_STYLES,
  COMPOSE_DRAFT_FORMATS,
  type ComposeQueryRequest,
  type EmbeddingUpsert,
  RUN_MODES,
  SNAPSHOT_TYPES,
  WATCH_TIERS,
  type FeedQuery,
  type MetricsSnapshotUpsert,
  type NarrativeShiftUpsert,
  type PipelineRunUpsert,
  type PostUpsert,
  type ReportUpsert,
  type SemanticQueryRequest,
  type WindowSummaryUpsert,
} from "@/lib/xmonitor/types";
import { defaultFeedLimit, maxFeedLimit } from "@/lib/xmonitor/config";

const COMPOSE_DEFAULT_RETRIEVAL_LIMIT = 50;
const COMPOSE_MAX_RETRIEVAL_LIMIT = 100;
const COMPOSE_DEFAULT_CONTEXT_LIMIT = 14;
const COMPOSE_MAX_CONTEXT_LIMIT = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return asString(value);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return value;
}

function asArray(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const text = asString(item);
    if (!text) return undefined;
    out.push(text);
  }
  return out;
}

function asNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) return undefined;
    out.push(item);
  }
  return out;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function asInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asIsoTimestamp(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function asTier(value: unknown): PostUpsert["watch_tier"] {
  const text = asString(value)?.toLowerCase();
  if (!text) return undefined;
  return WATCH_TIERS.includes(text as (typeof WATCH_TIERS)[number])
    ? (text as (typeof WATCH_TIERS)[number])
    : undefined;
}

export function parsePostUpsert(value: unknown): { ok: true; data: PostUpsert } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "item must be an object" };

  const statusId = asString(value.status_id);
  const url = asString(value.url);
  const authorHandle = asString(value.author_handle)?.toLowerCase();
  const discoveredAt = asIsoTimestamp(value.discovered_at);
  const lastSeenAt = asIsoTimestamp(value.last_seen_at);

  if (!statusId || !url || !authorHandle || !discoveredAt || !lastSeenAt) {
    return { ok: false, error: "status_id, url, author_handle, discovered_at, and last_seen_at are required" };
  }

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
      watch_tier: asTier(value.watch_tier) ?? null,
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

export function parseMetricsSnapshotUpsert(
  value: unknown
): { ok: true; data: MetricsSnapshotUpsert } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "item must be an object" };

  const statusId = asString(value.status_id);
  const snapshotType = asString(value.snapshot_type)?.toLowerCase();
  const snapshotAt = asIsoTimestamp(value.snapshot_at);

  if (!statusId || !snapshotType || !snapshotAt) {
    return { ok: false, error: "status_id, snapshot_type, and snapshot_at are required" };
  }

  if (!SNAPSHOT_TYPES.includes(snapshotType as (typeof SNAPSHOT_TYPES)[number])) {
    return { ok: false, error: "snapshot_type must be one of initial_capture, latest_observed, refresh_24h" };
  }

  return {
    ok: true,
    data: {
      status_id: statusId,
      snapshot_type: snapshotType as (typeof SNAPSHOT_TYPES)[number],
      snapshot_at: snapshotAt,
      likes: asInteger(value.likes) ?? 0,
      reposts: asInteger(value.reposts) ?? 0,
      replies: asInteger(value.replies) ?? 0,
      views: asInteger(value.views) ?? 0,
      source: asString(value.source) || "ingest",
    },
  };
}

export function parseReportUpsert(value: unknown): { ok: true; data: ReportUpsert } | { ok: false; error: string } {
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

export function parsePipelineRunUpsert(
  value: unknown
): { ok: true; data: PipelineRunUpsert } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "payload must be an object" };

  const runAt = asIsoTimestamp(value.run_at);
  const mode = asString(value.mode)?.toLowerCase();

  if (!runAt || !mode) {
    return { ok: false, error: "run_at and mode are required" };
  }

  if (!RUN_MODES.includes(mode as (typeof RUN_MODES)[number])) {
    return { ok: false, error: "mode must be one of priority, discovery, both, refresh24h, manual" };
  }

  return {
    ok: true,
    data: {
      run_at: runAt,
      mode: mode as (typeof RUN_MODES)[number],
      fetched_count: asInteger(value.fetched_count) ?? 0,
      significant_count: asInteger(value.significant_count) ?? 0,
      reported_count: asInteger(value.reported_count) ?? 0,
      note: asNullableString(value.note),
      source: asNullableString(value.source) ?? "local-dispatcher",
    },
  };
}

export function parseWindowSummaryUpsert(
  value: unknown
): { ok: true; data: WindowSummaryUpsert } | { ok: false; error: string } {
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

export function parseNarrativeShiftUpsert(
  value: unknown
): { ok: true; data: NarrativeShiftUpsert } | { ok: false; error: string } {
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

export function parseEmbeddingUpsert(value: unknown): { ok: true; data: EmbeddingUpsert } | { ok: false; error: string } {
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

export function parseBatchItems(value: unknown): { ok: true; items: unknown[] } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "body must be an object" };
  if (!Array.isArray(value.items)) return { ok: false, error: "body.items must be an array" };
  return { ok: true, items: value.items };
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

export function parseFeedQuery(input: Record<string, string | string[] | undefined>): FeedQuery {
  const since = asIsoTimestamp(firstValue(input.since));
  const until = asIsoTimestamp(firstValue(input.until));
  const tierRaw = asString(firstValue(input.tier))?.toLowerCase();
  const tier = WATCH_TIERS.includes(tierRaw as (typeof WATCH_TIERS)[number])
    ? (tierRaw as (typeof WATCH_TIERS)[number])
    : undefined;

  const significant = asBoolean(firstValue(input.significant));

  const limitValue = asInteger(firstValue(input.limit));
  const maxLimit = maxFeedLimit();
  const finalLimit = limitValue ? Math.min(Math.max(limitValue, 1), maxLimit) : defaultFeedLimit();
  const normalizedHandle = asString(firstValue(input.handle))
    ?.toLowerCase()
    .split(/\s+/)
    .filter((item) => item.length > 0)
    .join(" ");

  return {
    since,
    until,
    tier,
    handle: normalizedHandle || undefined,
    significant,
    q: asString(firstValue(input.q)),
    limit: finalLimit,
    cursor: asString(firstValue(input.cursor)),
  };
}

export function parseSemanticQueryRequest(
  value: unknown
): { ok: true; data: SemanticQueryRequest } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "body must be an object" };

  const queryText = asString(value.query_text);
  if (!queryText) {
    return { ok: false, error: "query_text is required" };
  }

  const since = asIsoTimestamp(value.since);
  const until = asIsoTimestamp(value.until);
  const tierRaw = asString(value.tier)?.toLowerCase();
  const tier = WATCH_TIERS.includes(tierRaw as (typeof WATCH_TIERS)[number])
    ? (tierRaw as (typeof WATCH_TIERS)[number])
    : undefined;
  const significant = asBoolean(value.significant);

  const limitValue = asInteger(value.limit);
  const maxLimit = maxFeedLimit();
  const finalLimit = limitValue ? Math.min(Math.max(limitValue, 1), maxLimit) : defaultFeedLimit();

  const normalizedHandle = asString(value.handle)
    ?.toLowerCase()
    .split(/\s+/)
    .filter((item) => item.length > 0)
    .join(" ");

  return {
    ok: true,
    data: {
      query_text: queryText,
      since,
      until,
      tier,
      handle: normalizedHandle || undefined,
      significant,
      limit: finalLimit,
    },
  };
}

export function parseComposeQueryRequest(
  value: unknown
): { ok: true; data: ComposeQueryRequest } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "body must be an object" };

  const taskText = asString(value.task_text);
  if (!taskText) {
    return { ok: false, error: "task_text is required" };
  }

  const since = asIsoTimestamp(value.since);
  const until = asIsoTimestamp(value.until);
  const tierRaw = asString(value.tier)?.toLowerCase();
  const tier = WATCH_TIERS.includes(tierRaw as (typeof WATCH_TIERS)[number])
    ? (tierRaw as (typeof WATCH_TIERS)[number])
    : undefined;
  const significant = asBoolean(value.significant);

  const retrievalLimitRaw = asInteger(value.retrieval_limit);
  const retrievalLimit = retrievalLimitRaw
    ? Math.min(Math.max(retrievalLimitRaw, 1), COMPOSE_MAX_RETRIEVAL_LIMIT)
    : COMPOSE_DEFAULT_RETRIEVAL_LIMIT;

  const contextLimitRaw = asInteger(value.context_limit);
  const contextLimitBounded = contextLimitRaw
    ? Math.min(Math.max(contextLimitRaw, 1), COMPOSE_MAX_CONTEXT_LIMIT)
    : COMPOSE_DEFAULT_CONTEXT_LIMIT;
  const contextLimit = Math.min(contextLimitBounded, retrievalLimit);

  const answerStyleRaw = asString(value.answer_style)?.toLowerCase();
  if (answerStyleRaw && !COMPOSE_ANSWER_STYLES.includes(answerStyleRaw as (typeof COMPOSE_ANSWER_STYLES)[number])) {
    return {
      ok: false,
      error: `answer_style must be one of ${COMPOSE_ANSWER_STYLES.join(", ")}`,
    };
  }
  const answerStyle = answerStyleRaw
    ? (answerStyleRaw as (typeof COMPOSE_ANSWER_STYLES)[number])
    : COMPOSE_ANSWER_STYLES[1];

  const draftFormatRaw = asString(value.draft_format)?.toLowerCase();
  if (draftFormatRaw && !COMPOSE_DRAFT_FORMATS.includes(draftFormatRaw as (typeof COMPOSE_DRAFT_FORMATS)[number])) {
    return {
      ok: false,
      error: `draft_format must be one of ${COMPOSE_DRAFT_FORMATS.join(", ")}`,
    };
  }
  const draftFormat = draftFormatRaw
    ? (draftFormatRaw as (typeof COMPOSE_DRAFT_FORMATS)[number])
    : COMPOSE_DRAFT_FORMATS[0];

  const normalizedHandle = asString(value.handle)
    ?.toLowerCase()
    .split(/\s+/)
    .filter((item) => item.length > 0)
    .join(" ");

  return {
    ok: true,
    data: {
      task_text: taskText,
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
