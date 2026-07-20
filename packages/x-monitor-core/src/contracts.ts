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
