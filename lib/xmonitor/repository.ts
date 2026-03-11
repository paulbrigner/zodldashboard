import type { QueryResultRow } from "pg";
import defaultIngestOmitHandles from "@/config/xmonitor/omit-handles.json";
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/xmonitor/cursor";
import { getDbPool } from "@/lib/xmonitor/db";
import { defaultFeedLimit, maxFeedLimit } from "@/lib/xmonitor/config";
import {
  buildOmitHandleSet,
  normalizeHandle,
  parseNormalizedHandleList,
  shouldOmitKeywordOriginMissingBaseTerm,
  shouldOmitKeywordOriginPost,
} from "@/shared/xmonitor/ingest-policy.mjs";
import type {
  ActivityTrendBucket,
  ActivityTrendTotals,
  BatchUpsertResult,
  ClassificationStatus,
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
  NarrativeShiftUpsert,
  PipelineRunUpsert,
  PostDetail,
  PostUpsert,
  ReconcileCounts,
  SignificanceBatchResult,
  SignificanceCandidate,
  SignificanceClaimRequest,
  SignificanceClaimResponse,
  SignificanceResultUpsert,
  TrendsResponse,
  WindowSummary,
  WindowSummaryUpsert,
} from "@/lib/xmonitor/types";

const DEFAULT_TREND_LOOKBACK_HOURS = 24 * 7;
const MAX_TREND_LOOKBACK_HOURS = 24 * 30;
const MAX_ENGAGEMENT_TOP_ITEMS = 12;
const TREND_RANGE_HOURS = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
} as const;

type TrendRangeKey = keyof typeof TREND_RANGE_HOURS;

function parseTrendRangeKey(value: string | undefined): TrendRangeKey | null {
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

const DEFAULT_INGEST_OMIT_HANDLES = defaultIngestOmitHandles as string[];

function ingestOmitHandleSet(): Set<string> {
  return buildOmitHandleSet(DEFAULT_INGEST_OMIT_HANDLES, process.env.XMONITOR_INGEST_OMIT_HANDLES);
}

function parseHandleFilter(value: string | undefined): string[] {
  return parseNormalizedHandleList(value);
}

function addWatchTierFilter(query: FeedQuery, params: unknown[], where: string[], postAlias = "p"): void {
  if (!query.tiers || query.tiers.length === 0) return;

  const includeOther = query.tiers.includes("other");
  const namedTiers = query.tiers.filter((tier) => tier !== "other");

  if (namedTiers.length > 0 && includeOther) {
    params.push(namedTiers);
    where.push(`(${postAlias}.watch_tier = ANY($${params.length}::text[]) OR ${postAlias}.watch_tier IS NULL)`);
    return;
  }

  if (namedTiers.length > 0) {
    params.push(namedTiers);
    where.push(`${postAlias}.watch_tier = ANY($${params.length}::text[])`);
    return;
  }

  where.push(`${postAlias}.watch_tier IS NULL`);
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
    classification_status: (row.classification_status ? String(row.classification_status) : "pending") as ClassificationStatus,
    classified_at: toIso(row.classified_at),
    classification_model: row.classification_model ? String(row.classification_model) : null,
    classification_confidence: row.classification_confidence === null || row.classification_confidence === undefined
      ? null
      : Number(row.classification_confidence),
    likes: Number(row.likes || 0),
    reposts: Number(row.reposts || 0),
    replies: Number(row.replies || 0),
    views: Number(row.views || 0),
  };
}

function classifiedSignificantPredicate(postAlias = "p"): string {
  return `${postAlias}.classification_status = 'classified' AND ${postAlias}.is_significant`;
}

function isClassificationRelevantChangeSql(): string {
  return [
    "posts.body_text IS DISTINCT FROM EXCLUDED.body_text",
    "posts.author_handle IS DISTINCT FROM EXCLUDED.author_handle",
    "posts.source_query IS DISTINCT FROM EXCLUDED.source_query",
    "posts.watch_tier IS DISTINCT FROM EXCLUDED.watch_tier",
  ].join("\n        OR ");
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
  const classificationResetSql = isClassificationRelevantChangeSql();
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
      classification_status,
      likes,
      reposts,
      replies,
      views,
      discovered_at,
      last_seen_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16,
      $17, $18
    )
    ON CONFLICT (status_id) DO UPDATE SET
      url = EXCLUDED.url,
      author_handle = EXCLUDED.author_handle,
      author_display = EXCLUDED.author_display,
      body_text = EXCLUDED.body_text,
      posted_relative = EXCLUDED.posted_relative,
      source_query = EXCLUDED.source_query,
      watch_tier = EXCLUDED.watch_tier,
      is_significant = CASE
        WHEN ${classificationResetSql} THEN FALSE
        ELSE posts.is_significant
      END,
      significance_reason = CASE
        WHEN ${classificationResetSql} THEN NULL
        ELSE posts.significance_reason
      END,
      significance_version = CASE
        WHEN ${classificationResetSql} THEN 'ai_v1'
        ELSE COALESCE(posts.significance_version, 'ai_v1')
      END,
      classification_status = CASE
        WHEN ${classificationResetSql} THEN 'pending'
        ELSE posts.classification_status
      END,
      classified_at = CASE
        WHEN ${classificationResetSql} THEN NULL
        ELSE posts.classified_at
      END,
      classification_model = CASE
        WHEN ${classificationResetSql} THEN NULL
        ELSE posts.classification_model
      END,
      classification_confidence = CASE
        WHEN ${classificationResetSql} THEN NULL
        ELSE posts.classification_confidence
      END,
      classification_attempts = CASE
        WHEN ${classificationResetSql} THEN 0
        ELSE posts.classification_attempts
      END,
      classification_error = CASE
        WHEN ${classificationResetSql} THEN NULL
        ELSE posts.classification_error
      END,
      classification_leased_at = CASE
        WHEN ${classificationResetSql} THEN NULL
        ELSE posts.classification_leased_at
      END,
      likes = EXCLUDED.likes,
      reposts = EXCLUDED.reposts,
      replies = EXCLUDED.replies,
      views = EXCLUDED.views,
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
    if (shouldOmitKeywordOriginMissingBaseTerm(item)) {
      result.errors.push({ index, message: "omitted keyword-origin post missing discovery base term" });
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
        false,
        null,
        "ai_v1",
        "pending",
        item.likes ?? 0,
        item.reposts ?? 0,
        item.replies ?? 0,
        item.views ?? 0,
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

export async function claimPostsForClassification(
  request: SignificanceClaimRequest
): Promise<SignificanceClaimResponse> {
  const pool = getDbPool();
  const limit = Math.min(Math.max(request.limit || 12, 1), 200);
  const leaseSeconds = Math.min(Math.max(request.lease_seconds || 300, 30), 3600);
  const maxAttempts = Math.min(Math.max(request.max_attempts || 3, 1), 10);
  const sql = `
    WITH candidates AS (
      SELECT p.status_id
      FROM posts p
      WHERE p.classification_attempts < $3
        AND (
          p.classification_status = 'pending'
          OR p.classification_status = 'failed'
          OR (
            p.classification_status = 'processing'
            AND (
              p.classification_leased_at IS NULL
              OR p.classification_leased_at < now() - make_interval(secs => $2)
            )
          )
        )
      ORDER BY p.discovered_at DESC, p.status_id DESC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE posts p
    SET
      classification_status = 'processing',
      classification_leased_at = now(),
      classification_attempts = p.classification_attempts + 1,
      classification_error = NULL,
      updated_at = now()
    FROM candidates c
    WHERE p.status_id = c.status_id
    RETURNING
      p.status_id,
      p.author_handle,
      p.author_display,
      p.body_text,
      p.source_query,
      p.watch_tier,
      p.discovered_at,
      p.last_seen_at,
      p.classification_attempts
  `;
  const result = await pool.query(sql, [limit, leaseSeconds, maxAttempts]);
  const items: SignificanceCandidate[] = result.rows.map((row) => ({
    status_id: String(row.status_id),
    author_handle: String(row.author_handle),
    author_display: row.author_display ? String(row.author_display) : null,
    body_text: row.body_text ? String(row.body_text) : null,
    source_query: row.source_query ? String(row.source_query) : null,
    watch_tier: row.watch_tier ? String(row.watch_tier) as SignificanceCandidate["watch_tier"] : null,
    discovered_at: toIso(row.discovered_at) || new Date(0).toISOString(),
    last_seen_at: toIso(row.last_seen_at) || new Date(0).toISOString(),
    classification_attempts: Number(row.classification_attempts || 0),
  }));
  return { items };
}

export async function applySignificanceResults(items: SignificanceResultUpsert[]): Promise<SignificanceBatchResult> {
  const pool = getDbPool();
  const result: SignificanceBatchResult = {
    received: items.length,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  const sql = `
    UPDATE posts
    SET
      is_significant = $2,
      significance_reason = $3,
      significance_version = $4,
      classification_status = $5,
      classified_at = CASE
        WHEN $5 = 'classified' THEN COALESCE($6::timestamptz, now())
        ELSE NULL
      END,
      classification_model = $7,
      classification_confidence = $8,
      classification_error = $9,
      classification_leased_at = NULL,
      updated_at = now()
    WHERE status_id = $1
    RETURNING status_id
  `;

  for (const [index, item] of items.entries()) {
    try {
      const dbResult = await pool.query(sql, [
        item.status_id,
        item.classification_status === "classified" ? Boolean(item.is_significant) : false,
        item.classification_status === "classified" ? item.significance_reason || null : null,
        item.significance_version || "ai_v1",
        item.classification_status,
        item.classified_at || null,
        item.classification_model || null,
        item.classification_confidence ?? null,
        item.classification_status === "failed" ? item.classification_error || "classification_failed" : null,
      ]);
      if (dbResult.rowCount === 0) {
        result.skipped += 1;
        result.errors.push({ index, message: `unknown status_id: ${item.status_id}` });
        continue;
      }
      result.updated += 1;
    } catch (error) {
      result.skipped += 1;
      result.errors.push({ index, message: errorMessage(error) });
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

export async function upsertPipelineRun(item: PipelineRunUpsert): Promise<BatchUpsertResult> {
  const result = buildBatchResult(1);
  const sql = `
    INSERT INTO pipeline_runs(run_at, mode, fetched_count, significant_count, note, source)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (run_at, mode, source) DO UPDATE SET
      fetched_count = EXCLUDED.fetched_count,
      significant_count = EXCLUDED.significant_count,
      note = EXCLUDED.note
    RETURNING (xmax = 0) AS inserted
  `;

  try {
    const inserted = await runUpsert(sql, [
      item.run_at,
      item.mode,
      item.fetched_count ?? 0,
      item.significant_count ?? 0,
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

  addWatchTierFilter(query, params, where, "p");

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
    where.push(`p.classification_status = 'classified' AND p.is_significant = ${query.significant ? "TRUE" : "FALSE"}`);
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

function normalizeTrendRange(
  query: FeedQuery,
  options: { rangeKey?: string | null } = {}
): { since: string; until: string; bucketHours: number; rangeKey: "24h" | "7d" | "30d" | "custom" } {
  const now = new Date();
  const requestedUntil = parseDateOrNull(query.until);
  const requestedSince = parseDateOrNull(query.since);

  let until = requestedUntil || now;
  const explicitRangeKey = parseTrendRangeKey(options.rangeKey || undefined);
  const explicitRangeHours = explicitRangeKey ? TREND_RANGE_HOURS[explicitRangeKey] : null;
  let since = requestedSince || new Date(until.getTime() - (explicitRangeHours || DEFAULT_TREND_LOOKBACK_HOURS) * 60 * 60 * 1000);
  let resolvedRangeKey: "24h" | "7d" | "30d" | "custom" = explicitRangeKey || "7d";

  if (since > until) {
    const originalSince = since;
    since = until;
    until = originalSince;
    resolvedRangeKey = "custom";
  }

  const maxLookbackMs = MAX_TREND_LOOKBACK_HOURS * 60 * 60 * 1000;
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

function collectorLaneCase(): string {
  return `
    CASE
      WHEN p.source_query = 'discovery' THEN 'discovery'
      WHEN p.source_query IN ('priority', 'priority_reply_selected', 'priority_reply_term') THEN 'priority'
      ELSE 'other'
    END
  `;
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
      p.classification_status,
      p.classified_at,
      p.classification_model,
      p.classification_confidence,
      p.likes,
      p.reposts,
      p.replies,
      p.views
    FROM posts p
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

export async function getTrends(
  query: FeedQuery,
  options: { applyTextQuery?: boolean; rangeKey?: string | null } = {}
): Promise<TrendsResponse> {
  const pool = getDbPool();
  const range = normalizeTrendRange(query, { rangeKey: options.rangeKey });
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

  const totalsSql = `
    WITH filtered AS (
      SELECT
        p.*,
        ${collectorLaneCase()} AS collector_lane
      FROM posts p
      ${whereSql}
    )
    SELECT
      COUNT(*)::bigint AS post_count,
      COUNT(*) FILTER (WHERE ${classifiedSignificantPredicate("filtered")})::bigint AS significant_count,
      COUNT(*) FILTER (WHERE watch_tier IS NOT NULL)::bigint AS watchlist_count,
      COUNT(*) FILTER (WHERE collector_lane = 'priority')::bigint AS priority_count,
      COUNT(*) FILTER (WHERE collector_lane = 'discovery')::bigint AS discovery_count,
      COUNT(*) FILTER (WHERE collector_lane = 'other')::bigint AS other_count,
      COUNT(DISTINCT author_handle)::bigint AS unique_handle_count
    FROM filtered
  `;

  const bucketsSql = `
    WITH filtered AS (
      SELECT
        p.*,
        ${collectorLaneCase()} AS collector_lane
      FROM posts p
      ${whereSql}
    ),
    bucketed AS (
      SELECT
        to_timestamp(floor(extract(epoch from discovered_at) / $${params.length + 1}) * $${params.length + 1}) AS bucket_start,
        COUNT(*)::bigint AS post_count,
        COUNT(*) FILTER (WHERE ${classifiedSignificantPredicate("filtered")})::bigint AS significant_count,
        COUNT(*) FILTER (WHERE watch_tier IS NOT NULL)::bigint AS watchlist_count,
        COUNT(*) FILTER (WHERE collector_lane = 'priority')::bigint AS priority_count,
        COUNT(*) FILTER (WHERE collector_lane = 'discovery')::bigint AS discovery_count,
        COUNT(*) FILTER (WHERE collector_lane = 'other')::bigint AS other_count,
        COUNT(DISTINCT author_handle)::bigint AS unique_handle_count
      FROM filtered
      GROUP BY 1
    )
    SELECT
      bucket_start,
      bucket_start + make_interval(secs => $${params.length + 1}) AS bucket_end,
      post_count,
      significant_count,
      watchlist_count,
      priority_count,
      discovery_count,
      other_count,
      unique_handle_count
    FROM bucketed
    ORDER BY bucket_start ASC
  `;

  const [totalsResult, bucketsResult] = await Promise.all([
    pool.query(totalsSql, params),
    pool.query(bucketsSql, [...params, bucketSeconds]),
  ]);

  const totalsRow = totalsResult.rows[0] || {};
  const totals: ActivityTrendTotals = {
    post_count: Number(totalsRow.post_count || 0),
    significant_count: Number(totalsRow.significant_count || 0),
    watchlist_count: Number(totalsRow.watchlist_count || 0),
    priority_count: Number(totalsRow.priority_count || 0),
    discovery_count: Number(totalsRow.discovery_count || 0),
    other_count: Number(totalsRow.other_count || 0),
    unique_handle_count: Number(totalsRow.unique_handle_count || 0),
  };

  const buckets: ActivityTrendBucket[] = bucketsResult.rows.map((row) => ({
    bucket_start: toIso(row.bucket_start) || new Date(0).toISOString(),
    bucket_end: toIso(row.bucket_end) || new Date(0).toISOString(),
    post_count: Number(row.post_count || 0),
    significant_count: Number(row.significant_count || 0),
    watchlist_count: Number(row.watchlist_count || 0),
    priority_count: Number(row.priority_count || 0),
    discovery_count: Number(row.discovery_count || 0),
    other_count: Number(row.other_count || 0),
    unique_handle_count: Number(row.unique_handle_count || 0),
  }));

  return {
    scope: {
      since: range.since,
      until: range.until,
      bucket_hours: range.bucketHours,
      range_key: range.rangeKey,
      text_filter_applied: options.applyTextQuery !== false,
    },
    activity: {
      totals,
      buckets,
    },
  };
}

export async function getEngagement(
  query: FeedQuery,
  options: { applyTextQuery?: boolean; rangeKey?: string | null } = {}
): Promise<EngagementResponse> {
  const pool = getDbPool();
  const range = normalizeTrendRange(query, { rangeKey: options.rangeKey });
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
      COUNT(*) FILTER (WHERE ${classifiedSignificantPredicate("filtered")})::bigint AS significant_count,
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
        COUNT(*) FILTER (WHERE ${classifiedSignificantPredicate("filtered")})::bigint AS significant_count,
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
      COUNT(*) FILTER (WHERE ${classifiedSignificantPredicate("filtered")})::bigint AS significant_count,
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
      COUNT(*) FILTER (WHERE ${classifiedSignificantPredicate("filtered")})::bigint AS significant_count,
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
        p.classification_status,
        p.classified_at,
        p.classification_model,
        p.classification_confidence,
        p.likes,
        p.reposts,
        p.replies,
        p.views
      FROM posts p
      WHERE p.status_id = $1
      LIMIT 1
    `,
    [statusId]
  );

  if (postResult.rowCount === 0) {
    return null;
  }

  const postRow = postResult.rows[0];

  return {
    post: rowToFeedItem(postRow),
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
            OR p.last_seen_at >= $1) AS posts,
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
