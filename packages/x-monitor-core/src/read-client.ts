import type {
  ActivityTrendsResponse,
  AuthorLocationSuggestionResponse,
  CuratedBriefing,
  CuratedBriefingsResponse,
  FeedQuery,
  FeedResponse,
  PostDetail,
  WindowSummariesLatestResponse,
  XMonitorSearchMode,
  XMonitorTrendRangeKey,
} from "./contracts";

export type XMonitorFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type XMonitorReadClientOptions = {
  baseUrl: string;
  fetch?: XMonitorFetch;
  headers?: HeadersInit;
};

export type XMonitorTrendsRequestOptions = {
  searchMode: XMonitorSearchMode;
  trendRange: XMonitorTrendRangeKey;
};

export type XMonitorReadClient = {
  feed(query: FeedQuery): Promise<FeedResponse>;
  latestSummaries(): Promise<WindowSummariesLatestResponse>;
  authorLocations(limit?: number): Promise<AuthorLocationSuggestionResponse>;
  activityTrends(
    query: FeedQuery,
    options: XMonitorTrendsRequestOptions
  ): Promise<ActivityTrendsResponse>;
  postDetail(statusId: string): Promise<PostDetail | null>;
  curatedBriefings(): Promise<CuratedBriefingsResponse>;
  curatedBriefing(slug: string): Promise<CuratedBriefing | null>;
};

function normalizeBaseUrl(value: string): string {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("X Monitor read client requires a baseUrl");
  }

  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("X Monitor read client baseUrl must use http or https");
  }
  return normalized;
}

function appendFeedFilters(url: URL, query: FeedQuery, includePagination: boolean): void {
  if (query.since) url.searchParams.set("since", query.since);
  if (query.until) url.searchParams.set("until", query.until);
  query.tiers?.forEach((tier) => url.searchParams.append("tier", tier));
  query.themes?.forEach((theme) => url.searchParams.append("theme", theme));
  query.debate_issues?.forEach((issue) => url.searchParams.append("debate_issue", issue));
  if (query.handle) url.searchParams.set("handle", query.handle);
  if (query.min_followers !== undefined) url.searchParams.set("min_followers", String(query.min_followers));
  if (query.max_followers !== undefined) url.searchParams.set("max_followers", String(query.max_followers));
  if (query.min_account_age_days !== undefined) {
    url.searchParams.set("min_account_age_days", String(query.min_account_age_days));
  }
  if (query.max_account_age_days !== undefined) {
    url.searchParams.set("max_account_age_days", String(query.max_account_age_days));
  }
  if (query.location) url.searchParams.set("location", query.location);
  url.searchParams.set("significant", query.significant === undefined ? "" : String(query.significant));
  if (query.q) url.searchParams.set("q", query.q);
  if (includePagination && query.limit !== undefined) {
    url.searchParams.set("limit", String(query.limit));
  }
  if (includePagination && query.cursor) url.searchParams.set("cursor", query.cursor);
}

export function buildFeedApiUrl(baseUrl: string, query: FeedQuery): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/feed`);
  appendFeedFilters(url, query, true);
  return url.toString();
}

export function buildLatestSummariesApiUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/window-summaries/latest`;
}

export function buildAuthorLocationsApiUrl(baseUrl: string, limit = 8): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/author-locations`);
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 8;
  url.searchParams.set("limit", String(normalizedLimit));
  return url.toString();
}

export function buildActivityTrendsApiUrl(
  baseUrl: string,
  query: FeedQuery,
  options: XMonitorTrendsRequestOptions
): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/trends`);
  appendFeedFilters(url, query, false);
  if (options.searchMode === "semantic") {
    url.searchParams.set("search_mode", "semantic");
  }
  url.searchParams.set("trend_range", options.trendRange);
  return url.toString();
}

export function buildPostDetailApiUrl(baseUrl: string, statusId: string): string {
  const normalizedStatusId = String(statusId || "").trim();
  if (!normalizedStatusId) {
    throw new Error("X Monitor post detail requires a statusId");
  }
  return `${normalizeBaseUrl(baseUrl)}/posts/${encodeURIComponent(normalizedStatusId)}`;
}

export function buildCuratedBriefingsApiUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/curated-briefings`;
}

export function buildCuratedBriefingApiUrl(baseUrl: string, slug: string): string {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) {
    throw new Error("X Monitor curated briefing requires a valid slug");
  }
  return `${normalizeBaseUrl(baseUrl)}/curated-briefings/${encodeURIComponent(normalizedSlug)}`;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Use the status fallback when the upstream did not return JSON.
  }
  return `API request failed (${response.status})`;
}

function mergeHeaders(defaultHeaders: HeadersInit | undefined): Headers | undefined {
  if (!defaultHeaders) return undefined;
  return new Headers(defaultHeaders);
}

export function createXMonitorReadClient(options: XMonitorReadClientOptions): XMonitorReadClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("X Monitor read client requires a fetch implementation");
  }

  async function get(url: string): Promise<Response> {
    return fetchImpl(url, {
      cache: "no-store",
      headers: mergeHeaders(options.headers),
      redirect: "manual",
    });
  }

  return {
    async feed(query) {
      const response = await get(buildFeedApiUrl(baseUrl, query));
      if (!response.ok) throw new Error(await readApiError(response));

      const payload = (await response.json()) as FeedResponse;
      if (!payload || !Array.isArray(payload.items)) {
        throw new Error("Invalid feed response payload");
      }
      return {
        items: payload.items,
        next_cursor:
          typeof payload.next_cursor === "string" && payload.next_cursor
            ? payload.next_cursor
            : null,
      };
    },

    async latestSummaries() {
      const response = await get(buildLatestSummariesApiUrl(baseUrl));
      if (!response.ok) throw new Error(await readApiError(response));

      const payload = (await response.json()) as WindowSummariesLatestResponse;
      if (!payload || !Array.isArray(payload.items)) {
        throw new Error("Invalid window summary response payload");
      }
      return payload;
    },

    async authorLocations(limit = 8) {
      const response = await get(buildAuthorLocationsApiUrl(baseUrl, limit));
      if (!response.ok) throw new Error(await readApiError(response));

      const payload = (await response.json()) as AuthorLocationSuggestionResponse;
      if (!payload || !Array.isArray(payload.items)) {
        throw new Error("Invalid author location response payload");
      }
      return {
        items: payload.items.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        ),
      };
    },

    async activityTrends(query, requestOptions) {
      const response = await get(buildActivityTrendsApiUrl(baseUrl, query, requestOptions));
      if (!response.ok) throw new Error(await readApiError(response));

      const payload = (await response.json()) as ActivityTrendsResponse;
      if (!payload || !payload.activity?.totals || !Array.isArray(payload.activity?.buckets)) {
        throw new Error("Invalid trends response payload");
      }
      return payload;
    },

    async postDetail(statusId) {
      const response = await get(buildPostDetailApiUrl(baseUrl, statusId));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(await readApiError(response));

      const payload = (await response.json()) as PostDetail;
      if (!payload || !payload.post) {
        throw new Error("Invalid post detail response payload");
      }
      return payload;
    },

    async curatedBriefings() {
      const response = await get(buildCuratedBriefingsApiUrl(baseUrl));
      if (!response.ok) throw new Error(await readApiError(response));

      const payload = (await response.json()) as CuratedBriefingsResponse;
      if (!payload || !Array.isArray(payload.items) || typeof payload.generated_at !== "string") {
        throw new Error("Invalid curated briefings response payload");
      }
      return payload;
    },

    async curatedBriefing(slug) {
      const response = await get(buildCuratedBriefingApiUrl(baseUrl, slug));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(await readApiError(response));

      const payload = (await response.json()) as CuratedBriefing;
      if (!payload || typeof payload.slug !== "string" || typeof payload.answer_text !== "string") {
        throw new Error("Invalid curated briefing response payload");
      }
      return payload;
    },
  };
}
