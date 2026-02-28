export const WATCH_TIERS = ["teammate", "influencer", "ecosystem"] as const;
export type WatchTier = (typeof WATCH_TIERS)[number];

export const SNAPSHOT_TYPES = ["initial_capture", "latest_observed", "refresh_24h"] as const;
export type SnapshotType = (typeof SNAPSHOT_TYPES)[number];

export const RUN_MODES = ["priority", "discovery", "both", "refresh24h", "manual"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const COMPOSE_ANSWER_STYLES = ["brief", "balanced", "detailed"] as const;
export type ComposeAnswerStyle = (typeof COMPOSE_ANSWER_STYLES)[number];

export const COMPOSE_DRAFT_FORMATS = ["none", "x_post", "thread"] as const;
export type ComposeDraftFormat = (typeof COMPOSE_DRAFT_FORMATS)[number];

export type BatchUpsertResult = {
  received: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
};

export type PostUpsert = {
  status_id: string;
  url: string;
  author_handle: string;
  author_display?: string | null;
  body_text?: string | null;
  posted_relative?: string | null;
  source_query?: string | null;
  watch_tier?: WatchTier | null;
  is_significant?: boolean;
  significance_reason?: string | null;
  significance_version?: string | null;
  likes?: number;
  reposts?: number;
  replies?: number;
  views?: number;
  initial_likes?: number | null;
  initial_reposts?: number | null;
  initial_replies?: number | null;
  initial_views?: number | null;
  likes_24h?: number | null;
  reposts_24h?: number | null;
  replies_24h?: number | null;
  views_24h?: number | null;
  refresh_24h_at?: string | null;
  refresh_24h_status?: string | null;
  refresh_24h_delta_likes?: number | null;
  refresh_24h_delta_reposts?: number | null;
  refresh_24h_delta_replies?: number | null;
  refresh_24h_delta_views?: number | null;
  discovered_at: string;
  last_seen_at: string;
};

export type MetricsSnapshotUpsert = {
  status_id: string;
  snapshot_type: SnapshotType;
  snapshot_at: string;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  source?: string;
};

export type ReportUpsert = {
  status_id: string;
  reported_at: string;
  channel?: string | null;
  destination?: string | null;
  summary?: string | null;
};

export type PipelineRunUpsert = {
  run_at: string;
  mode: RunMode;
  fetched_count?: number;
  significant_count?: number;
  reported_count?: number;
  note?: string | null;
  source?: string | null;
};

export type WindowSummaryUpsert = {
  summary_key: string;
  window_type: string;
  window_start: string;
  window_end: string;
  generated_at: string;
  post_count?: number;
  significant_count?: number;
  tier_counts?: Record<string, unknown>;
  top_themes?: unknown[];
  debates?: unknown[];
  top_authors?: unknown[];
  notable_posts?: unknown[];
  summary_text: string;
  source_version?: string | null;
  embedding_backend?: string | null;
  embedding_model?: string | null;
  embedding_dims?: number | null;
  embedding_vector?: number[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type WindowSummary = {
  summary_key: string;
  window_type: string;
  window_start: string;
  window_end: string;
  generated_at: string;
  post_count: number;
  significant_count: number;
  summary_text: string;
};

export type WindowSummariesLatestResponse = {
  items: WindowSummary[];
};

export type ReconcileCounts = {
  since: string;
  generated_at: string;
  counts: {
    posts: number;
    reports: number;
    pipeline_runs: number;
    window_summaries: number;
    narrative_shifts: number;
  };
};

export type DeletePostsByHandleResult = {
  author_handle: string;
  deleted: number;
};

export type NarrativeShiftUpsert = {
  shift_key: string;
  basis_window_type: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  source_summary_keys?: string[];
  emerging_themes?: unknown[];
  declining_themes?: unknown[];
  debate_intensity?: unknown[];
  position_shifts?: Record<string, unknown>;
  summary_text: string;
  source_version?: string | null;
  embedding_backend?: string | null;
  embedding_model?: string | null;
  embedding_dims?: number | null;
  embedding_vector?: number[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type EmbeddingUpsert = {
  status_id: string;
  backend: string;
  model: string;
  dims: number;
  vector: number[];
  text_hash: string;
  created_at: string;
  updated_at: string;
};

export type FeedItem = {
  status_id: string;
  discovered_at: string;
  author_handle: string;
  watch_tier: string | null;
  body_text: string | null;
  url: string;
  is_significant: boolean;
  significance_reason: string | null;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  reported_at: string | null;
  score?: number | null;
};

export type FeedResponse = {
  items: FeedItem[];
  next_cursor: string | null;
};

export type PostDetail = {
  post: FeedItem;
  snapshots: MetricsSnapshotUpsert[];
  report: ReportUpsert | null;
};

export type FeedQuery = {
  since?: string;
  until?: string;
  tier?: WatchTier;
  handle?: string;
  significant?: boolean;
  q?: string;
  limit?: number;
  cursor?: string;
};

export type SemanticQueryRequest = {
  query_text: string;
  since?: string;
  until?: string;
  tier?: WatchTier;
  handle?: string;
  significant?: boolean;
  limit?: number;
};

export type SemanticQueryResponse = {
  items: FeedItem[];
  model: string;
  retrieved_count: number;
};

export type ComposeQueryRequest = {
  task_text: string;
  since?: string;
  until?: string;
  tier?: WatchTier;
  handle?: string;
  significant?: boolean;
  retrieval_limit?: number;
  context_limit?: number;
  answer_style?: ComposeAnswerStyle;
  draft_format?: ComposeDraftFormat;
};

export type ComposeCitation = {
  status_id: string;
  url: string;
  author_handle: string;
  excerpt: string;
  score?: number | null;
};

export type ComposeRetrievalStats = {
  retrieved_count: number;
  used_count: number;
  model: string;
  latency_ms: number;
  coverage_score?: number | null;
};

export type ComposeQueryResponse = {
  answer_text: string;
  draft_text?: string | null;
  key_points: string[];
  citations: ComposeCitation[];
  retrieval_stats: ComposeRetrievalStats;
};

export type ComposeJobStatus = "queued" | "running" | "succeeded" | "failed" | "expired";

export type ComposeJobCreatedResponse = {
  job_id: string;
  status: ComposeJobStatus;
  created_at: string;
  expires_at: string;
  poll_after_ms?: number;
};

export type ComposeJobStatusResponse = {
  job_id: string;
  status: ComposeJobStatus;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  expires_at: string;
  poll_after_ms?: number;
  error?: {
    code: string;
    message: string;
  } | null;
  result?: ComposeQueryResponse | null;
};
