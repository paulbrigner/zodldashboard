export const WATCH_TIERS = ["teammate", "investor", "influencer", "ecosystem"] as const;
export type WatchTier = (typeof WATCH_TIERS)[number];

export const WATCH_TIER_FILTERS = [...WATCH_TIERS, "other"] as const;
export type WatchTierFilter = (typeof WATCH_TIER_FILTERS)[number];

export const CLASSIFICATION_STATUSES = ["pending", "processing", "classified", "failed"] as const;
export type ClassificationStatus = (typeof CLASSIFICATION_STATUSES)[number];

export type XMonitorSearchMode = "keyword" | "semantic";
export type XMonitorTrendRangeKey = "24h" | "7d" | "30d" | "90d";

export type FeedItem = {
  status_id: string;
  discovered_at: string;
  author_handle: string;
  watch_tier: string | null;
  followers_count?: number | null;
  account_created_at?: string | null;
  author_location?: string | null;
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

export type FeedQuery = {
  since?: string;
  until?: string;
  tiers?: WatchTierFilter[];
  themes?: string[];
  debate_issues?: string[];
  handle?: string;
  significant?: boolean;
  min_followers?: number;
  max_followers?: number;
  min_account_age_days?: number;
  max_account_age_days?: number;
  location?: string;
  q?: string;
  limit?: number;
  cursor?: string;
};

export type AuthorLocationSuggestionResponse = {
  items: string[];
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

export type TrendScope = {
  since: string;
  until: string;
  bucket_hours: number;
  range_key: XMonitorTrendRangeKey | "custom";
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

export type ActivityTrendsResponse = {
  scope: TrendScope;
  activity: {
    totals: ActivityTrendTotals;
    buckets: ActivityTrendBucket[];
  };
  summary?: unknown;
};

export type PostDetail = {
  post: FeedItem;
};

/**
 * A source selected by the curated-briefing generator. Briefing citations are
 * published snapshots: consumers must not use them to start a compose job.
 */
export type CuratedBriefingCitation = {
  status_id: string;
  author_handle: string;
  url: string;
  discovered_at: string;
  excerpt?: string | null;
  body_text?: string | null;
  score?: number | null;
};

export type CuratedBriefing = {
  topic_id: string;
  slug: string;
  question: string;
  category: string | null;
  order: number;
  version_id: string;
  answer_text: string;
  key_points: string[];
  citations: CuratedBriefingCitation[];
  generated_at: string;
  corpus_from?: string | null;
  corpus_through: string | null;
  reviewed_at: string | null;
  published_at: string;
  source_count: number;
  stale_after: string | null;
  stale: boolean;
  models?: {
    embedding: string | null;
    synthesis: string | null;
  };
  prompt_version?: string | null;
  provenance?: Record<string, unknown> | null;
};

export type CuratedBriefingsResponse = {
  items: CuratedBriefing[];
  generated_at: string;
};

export type CuratedBriefingAnswerStyle = "brief" | "balanced" | "detailed";
export type CuratedBriefingReviewStatus = "draft" | "published" | "rejected" | "superseded";

export type CuratedBriefingTopicInput = {
  slug: string;
  question: string;
  category?: string | null;
  editorial_context?: string | null;
  retrieval_config?: Record<string, unknown>;
  answer_style?: CuratedBriefingAnswerStyle;
  refresh_interval_minutes?: number;
  enabled?: boolean;
  order?: number;
};

export type CuratedBriefingTopic = {
  topic_id: string;
  slug: string;
  question: string;
  category: string | null;
  editorial_context: string | null;
  retrieval_config: Record<string, unknown>;
  answer_style: CuratedBriefingAnswerStyle;
  refresh_interval_minutes: number;
  enabled: boolean;
  order: number;
  next_refresh_at: string | null;
  last_scheduled_at: string | null;
  current_published_version_id: string | null;
  created_at: string;
  updated_at: string;
  latest_run?: CuratedBriefingRun | null;
};

export type CuratedBriefingRun = {
  run_id: string;
  topic_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  trigger_source?: "scheduled" | "manual";
  compose_job_id?: string | null;
  corpus_from?: string | null;
  corpus_through?: string | null;
  error?: { code: string; message: string } | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
};

export type CuratedBriefingVersion = {
  version_id: string;
  topic_id: string;
  slug: string;
  question: string;
  category: string | null;
  order: number;
  run_id: string | null;
  source_version_id: string | null;
  version_number: number;
  review_status: CuratedBriefingReviewStatus;
  answer_text: string;
  key_points: string[];
  citations: CuratedBriefingCitation[];
  source_count: number;
  corpus_from: string | null;
  corpus_through: string | null;
  generated_at: string;
  stale_after: string;
  stale: boolean;
  models?: {
    embedding: string | null;
    synthesis: string | null;
  };
  prompt_version: string;
  provenance: Record<string, unknown>;
  reviewed_at: string | null;
  published_at: string | null;
  rejection_reason: string | null;
  created_at: string;
};

export type CuratedBriefingTopicsResponse = {
  items: CuratedBriefingTopic[];
};

export type CuratedBriefingVersionsResponse = {
  items: CuratedBriefingVersion[];
};
