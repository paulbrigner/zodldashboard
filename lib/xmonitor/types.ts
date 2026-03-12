export const WATCH_TIERS = ["teammate", "investor", "influencer", "ecosystem"] as const;
export type WatchTier = (typeof WATCH_TIERS)[number];
export const WATCH_TIER_FILTERS = [...WATCH_TIERS, "other"] as const;
export type WatchTierFilter = (typeof WATCH_TIER_FILTERS)[number];

export const RUN_MODES = ["priority", "discovery", "both", "manual"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const CLASSIFICATION_STATUSES = ["pending", "processing", "classified", "failed"] as const;
export type ClassificationStatus = (typeof CLASSIFICATION_STATUSES)[number];

export const COMPOSE_ANSWER_STYLES = ["brief", "balanced", "detailed"] as const;
export type ComposeAnswerStyle = (typeof COMPOSE_ANSWER_STYLES)[number];

export const COMPOSE_DRAFT_FORMATS = ["none", "x_post", "thread", "email"] as const;
export type ComposeDraftFormat = (typeof COMPOSE_DRAFT_FORMATS)[number];

export const SCHEDULE_KINDS = ["interval", "weekly"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export const SCHEDULE_DAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type ScheduleDayCode = (typeof SCHEDULE_DAY_CODES)[number];

export const SCHEDULE_VISIBILITIES = ["personal", "shared"] as const;
export type ScheduleVisibility = (typeof SCHEDULE_VISIBILITIES)[number];

export type BatchUpsertResult = {
  received: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
  inserted_status_ids?: string[];
  updated_status_ids?: string[];
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
  discovered_at: string;
  last_seen_at: string;
};

export type SignificanceClaimRequest = {
  limit?: number;
  lease_seconds?: number;
  max_attempts?: number;
};

export type SignificanceCandidate = {
  status_id: string;
  author_handle: string;
  author_display: string | null;
  body_text: string | null;
  source_query: string | null;
  watch_tier: WatchTier | null;
  discovered_at: string;
  last_seen_at: string;
  classification_attempts: number;
};

export type SignificanceClaimResponse = {
  items: SignificanceCandidate[];
};

export type SignificanceResultUpsert = {
  status_id: string;
  classification_status: Extract<ClassificationStatus, "classified" | "failed">;
  is_significant?: boolean;
  significance_reason?: string | null;
  significance_version?: string | null;
  classification_model?: string | null;
  classification_confidence?: number | null;
  classification_error?: string | null;
  classified_at?: string | null;
};

export type SignificanceBatchResult = {
  received: number;
  updated: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
};

export type PipelineRunUpsert = {
  run_at: string;
  mode: RunMode;
  fetched_count?: number;
  significant_count?: number;
  note?: string | null;
  source?: string | null;
};

export type IngestQueryCheckpointUpsert = {
  query_key: string;
  collector_mode: "priority" | "discovery";
  query_family: string;
  query_text_hash: string;
  query_handles_hash?: string | null;
  since_id?: string | null;
  last_newest_id?: string | null;
  last_seen_at?: string | null;
  last_run_at?: string | null;
  last_run_status?: "ok" | "error" | null;
};

export type IngestQueryCheckpoint = {
  query_key: string;
  collector_mode: "priority" | "discovery";
  query_family: string;
  query_text_hash: string;
  query_handles_hash: string | null;
  since_id: string | null;
  last_newest_id: string | null;
  last_seen_at: string | null;
  last_run_at: string | null;
  last_run_status: "ok" | "error" | null;
  updated_at: string | null;
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
  classification_status: ClassificationStatus;
  classified_at?: string | null;
  classification_model?: string | null;
  classification_confidence?: number | null;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  score?: number | null;
};

export type FeedResponse = {
  items: FeedItem[];
  next_cursor: string | null;
};

export type TrendScope = {
  since: string;
  until: string;
  bucket_hours: number;
  range_key: "24h" | "7d" | "30d" | "custom";
  text_filter_applied: boolean;
};

export type ActivityTrendTotals = {
  post_count: number;
  significant_count: number;
  watchlist_count: number;
  priority_count: number;
  discovery_count: number;
  other_count: number;
  unique_handle_count: number;
};

export type ActivityTrendBucket = {
  bucket_start: string;
  bucket_end: string;
  post_count: number;
  significant_count: number;
  watchlist_count: number;
  priority_count: number;
  discovery_count: number;
  other_count: number;
  unique_handle_count: number;
};

export type SummaryMixTrendBucket = {
  bucket_start: string;
  bucket_end: string;
  post_count: number;
  significant_count: number;
  total_count: number;
  counts: Record<string, number>;
};

export type SummaryDebateCounts = {
  mentions: number;
  pro: number;
  contra: number;
};

export type SummaryDebateTrendBucket = {
  bucket_start: string;
  bucket_end: string;
  post_count: number;
  significant_count: number;
  total_mentions: number;
  issues: Record<string, SummaryDebateCounts>;
};

export type SummaryTrendScope = {
  coverage_start: string | null;
  coverage_end: string | null;
  source_window_type: string;
  source_bucket_hours: number;
  bucket_hours: number;
  conversation_wide: boolean;
};

export type SummaryTrends = {
  scope: SummaryTrendScope;
  theme_mix: {
    labels: string[];
    buckets: SummaryMixTrendBucket[];
  };
  debate_trends: {
    labels: string[];
    buckets: SummaryDebateTrendBucket[];
  };
  tier_mix: {
    labels: string[];
    buckets: SummaryMixTrendBucket[];
  };
};

export type TrendsResponse = {
  scope: TrendScope;
  activity: {
    totals: ActivityTrendTotals;
    buckets: ActivityTrendBucket[];
  };
  summary: SummaryTrends;
};

export type EngagementTotals = {
  post_count: number;
  significant_count: number;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  engagement_score: number;
};

export type EngagementBucket = {
  bucket_start: string;
  bucket_end: string;
  post_count: number;
  significant_count: number;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  engagement_score: number;
};

export type EngagementTierBreakdown = {
  watch_tier: string;
  post_count: number;
  significant_count: number;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  engagement_score: number;
};

export type EngagementHandleBreakdown = {
  author_handle: string;
  post_count: number;
  significant_count: number;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  engagement_score: number;
};

export type EngagementTopPost = {
  status_id: string;
  discovered_at: string;
  author_handle: string;
  watch_tier: string | null;
  body_text: string | null;
  url: string;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  engagement_score: number;
};

export type EngagementResponse = {
  scope: TrendScope;
  totals: EngagementTotals;
  buckets: EngagementBucket[];
  by_tier: EngagementTierBreakdown[];
  top_handles: EngagementHandleBreakdown[];
  top_posts: EngagementTopPost[];
};

export type PostDetail = {
  post: FeedItem;
};

export type FeedQuery = {
  since?: string;
  until?: string;
  tiers?: WatchTierFilter[];
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
  tiers?: WatchTierFilter[];
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
  tiers?: WatchTierFilter[];
  handle?: string;
  significant?: boolean;
  retrieval_limit?: number;
  context_limit?: number;
  answer_style?: ComposeAnswerStyle;
  draft_format?: ComposeDraftFormat;
};

export type ComposeEmailDraft = {
  subject: string;
  body_markdown: string;
  body_text?: string | null;
};

export type ComposeCitation = {
  status_id: string;
  url: string;
  author_handle: string;
  excerpt: string;
  body_text?: string | null;
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
  email_draft?: ComposeEmailDraft | null;
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

export type EmailSendRequest = {
  to: string[] | string;
  subject: string;
  body_markdown: string;
  body_text?: string | null;
  compose_job_id?: string;
  scheduled_job_id?: string;
  scheduled_run_id?: string;
};

export type EmailSendResponse = {
  delivery_id: string;
  status: "sent" | "failed";
  provider: "ses";
  provider_message_id?: string | null;
  sent_at?: string | null;
};

export type ScheduledEmailJob = {
  job_id: string;
  owner_email: string;
  name: string;
  enabled: boolean;
  visibility: ScheduleVisibility;
  recipients: string[];
  subject_override?: string | null;
  schedule_kind: ScheduleKind;
  schedule_days: ScheduleDayCode[];
  schedule_time_local?: string | null;
  schedule_interval_minutes: number;
  lookback_hours: number;
  timezone: string;
  next_run_at: string;
  last_run_at?: string | null;
  last_status?: "queued" | "running" | "succeeded" | "failed" | "skipped" | null;
  last_error?: string | null;
  run_count: number;
  compose_request: ComposeQueryRequest;
  created_at: string;
  updated_at: string;
};

export type ScheduledEmailRun = {
  run_id: string;
  scheduled_job_id: string;
  owner_email: string;
  scheduled_for: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  started_at?: string | null;
  completed_at?: string | null;
  compose_job_id?: string | null;
  delivery_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  created_at: string;
};

export type ScheduledEmailJobListResponse = {
  items: ScheduledEmailJob[];
};
