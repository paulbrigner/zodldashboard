import type { QueryResultRow } from "pg";
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/xmonitor/cursor";
import { getDbPool } from "@/lib/xmonitor/db";
import { defaultFeedLimit, maxFeedLimit } from "@/lib/xmonitor/config";
import type {
  BatchUpsertResult,
  DeletePostsByHandleResult,
  EngagementHandleBreakdown,
  EngagementResponse,
  EngagementTierBreakdown,
  EngagementTopPost,
  EngagementTotals,
  EngagementBucket,
  EmbeddingUpsert,
  FeedItem,
  FeedQuery,
  FeedResponse,
  IngestQueryCheckpoint,
  IngestQueryCheckpointUpsert,
  MetricsSnapshotUpsert,
  NarrativeShiftUpsert,
  PipelineRunUpsert,
  PostDetail,
  PostUpsert,
  ReconcileCounts,
  ReportUpsert,
  WindowSummary,
  WindowSummaryUpsert,
} from "@/lib/xmonitor/types";

const DEFAULT_ENGAGEMENT_LOOKBACK_HOURS = 24 * 7;
const MAX_ENGAGEMENT_LOOKBACK_HOURS = 24 * 30;
const MAX_ENGAGEMENT_TOP_ITEMS = 12;
const ENGAGEMENT_RANGE_HOURS = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
} as const;

type EngagementRangeKey = keyof typeof ENGAGEMENT_RANGE_HOURS;

function parseEngagementRangeKey(value: string | undefined): EngagementRangeKey | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "24h" || normalized === "7d" || normalized === "30d") {
    return normalized;
  }
  return null;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

const DEFAULT_INGEST_OMIT_HANDLES = ["zec_88", "zec__2"] as const;

function parseNormalizedHandleList(value: string | undefined): string[] {
  if (!value) return [];

  const handles = value
    .split(/[,\s]+/)
    .map((item) => normalizeHandle(item))
    .filter((item) => item.length > 0);

  return [...new Set(handles)];
}

function ingestOmitHandleSet(): Set<string> {
  return new Set([
    ...DEFAULT_INGEST_OMIT_HANDLES,
    ...parseNormalizedHandleList(process.env.XMONITOR_INGEST_OMIT_HANDLES),
  ]);
}

function isKeywordSourceQuery(sourceQuery: string | null | undefined): boolean {
  const normalized = String(sourceQuery || "")
    .trim()
    .toLowerCase();
  return normalized === "discovery" || normalized === "keyword" || normalized === "both" || normalized === "legacy";
}

function shouldOmitKeywordOriginPost(item: PostUpsert, authorHandle: string, omitHandles: Set<string>): boolean {
  if (!omitHandles.has(authorHandle)) return false;
  if (!isKeywordSourceQuery(item.source_query)) return false;
  if (item.watch_tier && String(item.watch_tier).trim().length > 0) return false;
  return true;
}

function parseHandleFilter(value: string | undefined): string[] {
  return parseNormalizedHandleList(value);
}

function rowToFeedItem(row: QueryResultRow): FeedItem {
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
  };
}

function rowToWindowSummary(row: QueryResultRow): WindowSummary {
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

function rowToIngestQueryCheckpoint(row: QueryResultRow): IngestQueryCheckpoint {
  return {
    query_key: String(row.query_key),
    collector_mode: String(row.collector_mode) as "priority" | "discovery",
    query_family: String(row.query_family),
    query_text_hash: String(row.query_text_hash),
    query_handles_hash: row.query_handles_hash ? String(row.query_handles_hash) : null,
    since_id: row.since_id ? String(row.since_id) : null,
    last_newest_id: row.last_newest_id ? String(row.last_newest_id) : null,
    last_seen_at: toIso(row.last_seen_at),
    last_run_at: toIso(row.last_run_at),
    last_run_status: row.last_run_status ? String(row.last_run_status) as "ok" | "error" : null,
    updated_at: toIso(row.updated_at),
  };
}

function buildBatchResult(received: number): BatchUpsertResult {
  return {
    received,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

function asJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value)).join(",")}]`;
}

async function runUpsert(
  sql: string,
  values: unknown[]
): Promise<{ inserted: boolean }> {
  const pool = getDbPool();
  const result = await pool.query<{ inserted: boolean }>(sql, values);
  return { inserted: Boolean(result.rows[0]?.inserted) };
}

export async function upsertPosts(items: PostUpsert[]): Promise<BatchUpsertResult> {
  const result = buildBatchResult(items.length);
  result.inserted_status_ids = [];
  result.updated_status_ids = [];
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
        result.inserted_status_ids.push(item.status_id);
      } else {
        result.updated += 1;
        result.updated_status_ids.push(item.status_id);
      }
    } catch (error) {
      result.errors.push({ index, message: errorMessage(error) });
      result.skipped += 1;
    }
  }

  return result;
}

export async function purgePostsByAuthorHandle(authorHandle: string): Promise<DeletePostsByHandleResult> {
  const normalizedHandle = normalizeHandle(authorHandle);
  const pool = getDbPool();
  const result = await pool.query(
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

export async function upsertMetricSnapshots(items: MetricsSnapshotUpsert[]): Promise<BatchUpsertResult> {
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

export async function upsertReports(items: ReportUpsert[]): Promise<BatchUpsertResult> {
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

export async function upsertPipelineRun(item: PipelineRunUpsert): Promise<BatchUpsertResult> {
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

export async function getIngestQueryCheckpoints(queryKeys: string[]): Promise<IngestQueryCheckpoint[]> {
  const normalizedKeys = [...new Set(queryKeys.map((item) => String(item || "").trim()).filter(Boolean))];
  if (normalizedKeys.length === 0) return [];

  const pool = getDbPool();
  const result = await pool.query(
    `
      SELECT
        query_key,
        collector_mode,
        query_family,
        query_text_hash,
        query_handles_hash,
        since_id,
        last_newest_id,
        last_seen_at,
        last_run_at,
        last_run_status,
        updated_at
      FROM ingest_query_checkpoints
      WHERE query_key = ANY($1::text[])
    `,
    [normalizedKeys]
  );

  return result.rows.map(rowToIngestQueryCheckpoint);
}

export async function upsertIngestQueryCheckpoints(items: IngestQueryCheckpointUpsert[]): Promise<BatchUpsertResult> {
  const result = buildBatchResult(items.length);
  const sql = `
    INSERT INTO ingest_query_checkpoints(
      query_key,
      collector_mode,
      query_family,
      query_text_hash,
      query_handles_hash,
      since_id,
      last_newest_id,
      last_seen_at,
      last_run_at,
      last_run_status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (query_key) DO UPDATE SET
      collector_mode = EXCLUDED.collector_mode,
      query_family = EXCLUDED.query_family,
      query_text_hash = EXCLUDED.query_text_hash,
      query_handles_hash = EXCLUDED.query_handles_hash,
      since_id = EXCLUDED.since_id,
      last_newest_id = EXCLUDED.last_newest_id,
      last_seen_at = EXCLUDED.last_seen_at,
      last_run_at = EXCLUDED.last_run_at,
      last_run_status = EXCLUDED.last_run_status,
      updated_at = now()
    RETURNING (xmax = 0) AS inserted
  `;

  for (const [index, item] of items.entries()) {
    try {
      const inserted = await runUpsert(sql, [
        item.query_key,
        item.collector_mode,
        item.query_family,
        item.query_text_hash,
        item.query_handles_hash ?? null,
        item.since_id ?? null,
        item.last_newest_id ?? null,
        item.last_seen_at ?? null,
        item.last_run_at ?? null,
        item.last_run_status ?? null,
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

export async function upsertWindowSummaries(items: WindowSummaryUpsert[]): Promise<BatchUpsertResult> {
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

export async function upsertNarrativeShifts(items: NarrativeShiftUpsert[]): Promise<BatchUpsertResult> {
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

export async function upsertEmbeddings(items: EmbeddingUpsert[]): Promise<BatchUpsertResult> {
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

export async function getLatestWindowSummaries(): Promise<WindowSummary[]> {
  const pool = getDbPool();
  const result = await pool.query(
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

  return result.rows
    .filter((row) => row.summary_key)
    .map(rowToWindowSummary);
}

type FeedWhereBuildOptions = {
  includeCursor?: boolean;
  includeTextQuery?: boolean;
};

function buildFeedWhereClause(query: FeedQuery, options: FeedWhereBuildOptions = {}): { where: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

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

  if (options.includeTextQuery !== false && query.q) {
    params.push(`%${query.q}%`);
    where.push(`(
      p.body_text ILIKE $${params.length}
      OR p.author_handle::text ILIKE $${params.length}
    )`);
  }

  if (options.includeCursor && query.cursor) {
    const decoded = decodeFeedCursor(query.cursor);
    if (decoded) {
      params.push(decoded.discovered_at);
      params.push(decoded.status_id);
      where.push(`(p.discovered_at, p.status_id) < ($${params.length - 1}, $${params.length})`);
    }
  }

  return { where, params };
}

function parseDateOrNull(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeEngagementRange(
  query: FeedQuery,
  options: { rangeKey?: string | null } = {}
): { since: string; until: string; bucketHours: number; rangeKey: "24h" | "7d" | "30d" | "custom" } {
  const now = new Date();
  const requestedUntil = parseDateOrNull(query.until);
  const requestedSince = parseDateOrNull(query.since);

  let until = requestedUntil || now;
  const explicitRangeKey = parseEngagementRangeKey(options.rangeKey || undefined);
  const explicitRangeHours = explicitRangeKey ? ENGAGEMENT_RANGE_HOURS[explicitRangeKey] : null;
  let since = requestedSince || new Date(until.getTime() - (explicitRangeHours || DEFAULT_ENGAGEMENT_LOOKBACK_HOURS) * 60 * 60 * 1000);
  let resolvedRangeKey: "24h" | "7d" | "30d" | "custom" = explicitRangeKey || "7d";

  if (since > until) {
    const originalSince = since;
    since = until;
    until = originalSince;
    resolvedRangeKey = "custom";
  }

  const maxLookbackMs = MAX_ENGAGEMENT_LOOKBACK_HOURS * 60 * 60 * 1000;
  if (until.getTime() - since.getTime() > maxLookbackMs) {
    since = new Date(until.getTime() - maxLookbackMs);
    resolvedRangeKey = "custom";
  }

  if (requestedSince || requestedUntil) {
    resolvedRangeKey = "custom";
  }

  const durationHours = Math.max((until.getTime() - since.getTime()) / (60 * 60 * 1000), 1);
  let bucketHours = 1;
  if (durationHours > 48) bucketHours = 2;
  if (durationHours > 24 * 7) bucketHours = 6;
  if (durationHours > 24 * 14) bucketHours = 12;
  if (durationHours > 24 * 21) bucketHours = 24;

  return {
    since: since.toISOString(),
    until: until.toISOString(),
    bucketHours,
    rangeKey: resolvedRangeKey,
  };
}

export async function getFeed(query: FeedQuery): Promise<FeedResponse> {
  const pool = getDbPool();
  const { where, params } = buildFeedWhereClause(query, { includeCursor: true, includeTextQuery: true });

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

  const rows = await pool.query(sql, params);
  const hasMore = rows.rows.length > limit;
  const sliced = hasMore ? rows.rows.slice(0, limit) : rows.rows;
  const items = sliced.map(rowToFeedItem);

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const tail = items[items.length - 1];
    nextCursor = encodeFeedCursor({ discovered_at: tail.discovered_at, status_id: tail.status_id });
  }

  return { items, next_cursor: nextCursor };
}

export async function getEngagement(
  query: FeedQuery,
  options: { applyTextQuery?: boolean; rangeKey?: string | null } = {}
): Promise<EngagementResponse> {
  const pool = getDbPool();
  const range = normalizeEngagementRange(query, { rangeKey: options.rangeKey });
  const scopedQuery: FeedQuery = {
    ...query,
    since: range.since,
    until: range.until,
    cursor: undefined,
  };
  const { where, params } = buildFeedWhereClause(scopedQuery, {
    includeCursor: false,
    includeTextQuery: options.applyTextQuery !== false,
  });
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const bucketSeconds = range.bucketHours * 60 * 60;
  const topLimit = MAX_ENGAGEMENT_TOP_ITEMS;

  const totalsSql = `
    WITH filtered AS (
      SELECT p.*
      FROM posts p
      ${whereSql}
    )
    SELECT
      COUNT(*)::bigint AS post_count,
      COUNT(*) FILTER (WHERE is_significant)::bigint AS significant_count,
      COALESCE(SUM(likes), 0)::bigint AS likes,
      COALESCE(SUM(reposts), 0)::bigint AS reposts,
      COALESCE(SUM(replies), 0)::bigint AS replies,
      COALESCE(SUM(views), 0)::bigint AS views,
      COALESCE(SUM(likes + (2 * reposts) + (3 * replies) + (views * 0.01)), 0)::double precision AS engagement_score
    FROM filtered
  `;

  const bucketsSql = `
    WITH filtered AS (
      SELECT p.*
      FROM posts p
      ${whereSql}
    ),
    bucketed AS (
      SELECT
        to_timestamp(floor(extract(epoch from discovered_at) / $${params.length + 1}) * $${params.length + 1}) AS bucket_start,
        COUNT(*)::bigint AS post_count,
        COUNT(*) FILTER (WHERE is_significant)::bigint AS significant_count,
        COALESCE(SUM(likes), 0)::bigint AS likes,
        COALESCE(SUM(reposts), 0)::bigint AS reposts,
        COALESCE(SUM(replies), 0)::bigint AS replies,
        COALESCE(SUM(views), 0)::bigint AS views,
        COALESCE(SUM(likes + (2 * reposts) + (3 * replies) + (views * 0.01)), 0)::double precision AS engagement_score
      FROM filtered
      GROUP BY 1
    )
    SELECT
      bucket_start,
      bucket_start + make_interval(secs => $${params.length + 1}) AS bucket_end,
      post_count,
      significant_count,
      likes,
      reposts,
      replies,
      views,
      engagement_score
    FROM bucketed
    ORDER BY bucket_start ASC
  `;

  const tiersSql = `
    WITH filtered AS (
      SELECT p.*
      FROM posts p
      ${whereSql}
    )
    SELECT
      COALESCE(watch_tier, 'other') AS watch_tier,
      COUNT(*)::bigint AS post_count,
      COUNT(*) FILTER (WHERE is_significant)::bigint AS significant_count,
      COALESCE(SUM(likes), 0)::bigint AS likes,
      COALESCE(SUM(reposts), 0)::bigint AS reposts,
      COALESCE(SUM(replies), 0)::bigint AS replies,
      COALESCE(SUM(views), 0)::bigint AS views,
      COALESCE(SUM(likes + (2 * reposts) + (3 * replies) + (views * 0.01)), 0)::double precision AS engagement_score
    FROM filtered
    GROUP BY COALESCE(watch_tier, 'other')
    ORDER BY engagement_score DESC, post_count DESC
  `;

  const handlesSql = `
    WITH filtered AS (
      SELECT p.*
      FROM posts p
      ${whereSql}
    )
    SELECT
      author_handle,
      COUNT(*)::bigint AS post_count,
      COUNT(*) FILTER (WHERE is_significant)::bigint AS significant_count,
      COALESCE(SUM(likes), 0)::bigint AS likes,
      COALESCE(SUM(reposts), 0)::bigint AS reposts,
      COALESCE(SUM(replies), 0)::bigint AS replies,
      COALESCE(SUM(views), 0)::bigint AS views,
      COALESCE(SUM(likes + (2 * reposts) + (3 * replies) + (views * 0.01)), 0)::double precision AS engagement_score
    FROM filtered
    GROUP BY author_handle
    ORDER BY engagement_score DESC, post_count DESC
    LIMIT $${params.length + 1}
  `;

  const postsSql = `
    WITH filtered AS (
      SELECT p.*
      FROM posts p
      ${whereSql}
    )
    SELECT
      status_id,
      discovered_at,
      author_handle,
      watch_tier,
      body_text,
      url,
      likes,
      reposts,
      replies,
      views,
      (likes + (2 * reposts) + (3 * replies) + (views * 0.01))::double precision AS engagement_score
    FROM filtered
    ORDER BY engagement_score DESC, discovered_at DESC
    LIMIT $${params.length + 1}
  `;

  const [totalsResult, bucketsResult, tiersResult, handlesResult, postsResult] = await Promise.all([
    pool.query(totalsSql, params),
    pool.query(bucketsSql, [...params, bucketSeconds]),
    pool.query(tiersSql, params),
    pool.query(handlesSql, [...params, topLimit]),
    pool.query(postsSql, [...params, topLimit]),
  ]);

  const totalsRow = totalsResult.rows[0] || {};
  const totals: EngagementTotals = {
    post_count: Number(totalsRow.post_count || 0),
    significant_count: Number(totalsRow.significant_count || 0),
    likes: Number(totalsRow.likes || 0),
    reposts: Number(totalsRow.reposts || 0),
    replies: Number(totalsRow.replies || 0),
    views: Number(totalsRow.views || 0),
    engagement_score: Number(totalsRow.engagement_score || 0),
  };

  const buckets: EngagementBucket[] = bucketsResult.rows.map((row) => ({
    bucket_start: toIso(row.bucket_start) || new Date(0).toISOString(),
    bucket_end: toIso(row.bucket_end) || new Date(0).toISOString(),
    post_count: Number(row.post_count || 0),
    significant_count: Number(row.significant_count || 0),
    likes: Number(row.likes || 0),
    reposts: Number(row.reposts || 0),
    replies: Number(row.replies || 0),
    views: Number(row.views || 0),
    engagement_score: Number(row.engagement_score || 0),
  }));

  const by_tier: EngagementTierBreakdown[] = tiersResult.rows.map((row) => ({
    watch_tier: String(row.watch_tier || "other"),
    post_count: Number(row.post_count || 0),
    significant_count: Number(row.significant_count || 0),
    likes: Number(row.likes || 0),
    reposts: Number(row.reposts || 0),
    replies: Number(row.replies || 0),
    views: Number(row.views || 0),
    engagement_score: Number(row.engagement_score || 0),
  }));

  const top_handles: EngagementHandleBreakdown[] = handlesResult.rows.map((row) => ({
    author_handle: String(row.author_handle),
    post_count: Number(row.post_count || 0),
    significant_count: Number(row.significant_count || 0),
    likes: Number(row.likes || 0),
    reposts: Number(row.reposts || 0),
    replies: Number(row.replies || 0),
    views: Number(row.views || 0),
    engagement_score: Number(row.engagement_score || 0),
  }));

  const top_posts: EngagementTopPost[] = postsResult.rows.map((row) => ({
    status_id: String(row.status_id),
    discovered_at: toIso(row.discovered_at) || new Date(0).toISOString(),
    author_handle: String(row.author_handle),
    watch_tier: row.watch_tier ? String(row.watch_tier) : null,
    body_text: row.body_text ? String(row.body_text) : null,
    url: String(row.url),
    likes: Number(row.likes || 0),
    reposts: Number(row.reposts || 0),
    replies: Number(row.replies || 0),
    views: Number(row.views || 0),
    engagement_score: Number(row.engagement_score || 0),
  }));

  return {
    scope: {
      since: range.since,
      until: range.until,
      bucket_hours: range.bucketHours,
      range_key: range.rangeKey,
      text_filter_applied: options.applyTextQuery !== false,
    },
    totals,
    buckets,
    by_tier,
    top_handles,
    top_posts,
  };
}

export async function getPostDetail(statusId: string): Promise<PostDetail | null> {
  const pool = getDbPool();

  const postResult = await pool.query(
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

  const snapshotsResult = await pool.query(
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

export async function getReconcileCounts(since: string): Promise<ReconcileCounts> {
  const pool = getDbPool();
  const result = await pool.query(
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

export async function pingDatabase(): Promise<void> {
  const pool = getDbPool();
  await pool.query("SELECT 1");
}
