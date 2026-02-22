import { RUN_MODES, SNAPSHOT_TYPES, WATCH_TIERS, type FeedQuery, type MetricsSnapshotUpsert, type PipelineRunUpsert, type PostUpsert, type ReportUpsert } from "@/lib/xmonitor/types";
import { defaultFeedLimit, maxFeedLimit } from "@/lib/xmonitor/config";

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
