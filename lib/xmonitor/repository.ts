import type { QueryResultRow } from "pg";
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/xmonitor/cursor";
import { getDbPool } from "@/lib/xmonitor/db";
import { defaultFeedLimit, maxFeedLimit } from "@/lib/xmonitor/config";
import type {
  BatchUpsertResult,
  FeedItem,
  FeedQuery,
  FeedResponse,
  MetricsSnapshotUpsert,
  NarrativeShiftUpsert,
  PipelineRunUpsert,
  PostDetail,
  PostUpsert,
  ReportUpsert,
  WindowSummary,
  WindowSummaryUpsert,
} from "@/lib/xmonitor/types";

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
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
    try {
      const inserted = await runUpsert(sql, [
        item.status_id,
        item.url,
        normalizeHandle(item.author_handle),
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

export async function getFeed(query: FeedQuery): Promise<FeedResponse> {
  const pool = getDbPool();
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
    params.push(normalizeHandle(query.handle));
    where.push(`p.author_handle = $${params.length}`);
  }

  if (query.significant !== undefined) {
    params.push(query.significant);
    where.push(`p.is_significant = $${params.length}`);
  }

  if (query.q) {
    params.push(`%${query.q}%`);
    const clause = `(
      p.body_text ILIKE $${params.length}
      OR p.author_handle::text ILIKE $${params.length}
    )`;
    where.push(clause);
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

export async function pingDatabase(): Promise<void> {
  const pool = getDbPool();
  await pool.query("SELECT 1");
}
