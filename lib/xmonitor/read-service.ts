import {
  createXMonitorReadClient,
  type XMonitorTrendsRequestOptions,
} from "@xmonitor/core/read-client";
import type {
  ActivityTrendsResponse,
  FeedQuery,
  FeedResponse,
  PostDetail,
  WindowSummary,
} from "@xmonitor/core/contracts";
import { readApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";
import {
  getAuthorLocationSuggestions,
  getFeed,
  getLatestWindowSummaries,
  getPostDetail,
  getTrends,
} from "@/lib/xmonitor/repository";

export type XMonitorReadMode = "api" | "database" | "unconfigured";

export type XMonitorReadService = {
  mode: XMonitorReadMode;
  apiBaseUrl: string | null;
  feed(query: FeedQuery): Promise<FeedResponse>;
  latestSummaries(): Promise<WindowSummary[]>;
  authorLocations(limit?: number): Promise<string[]>;
  activityTrends(
    query: FeedQuery,
    options: XMonitorTrendsRequestOptions
  ): Promise<ActivityTrendsResponse>;
  postDetail(statusId: string): Promise<PostDetail | null>;
};

function unconfigured(): never {
  throw new Error(
    "No X Monitor read backend configured. Set XMONITOR_READ_API_BASE_URL/" +
      "XMONITOR_BACKEND_API_BASE_URL or DATABASE_URL/PG*."
  );
}

export function createXMonitorReadService(): XMonitorReadService {
  const apiBaseUrl = readApiBaseUrl();
  if (apiBaseUrl) {
    const client = createXMonitorReadClient({ baseUrl: apiBaseUrl });
    return {
      mode: "api",
      apiBaseUrl,
      feed: (query) => client.feed(query),
      latestSummaries: async () => (await client.latestSummaries()).items,
      authorLocations: async (limit) => (await client.authorLocations(limit)).items,
      activityTrends: (query, options) => client.activityTrends(query, options),
      postDetail: (statusId) => client.postDetail(statusId),
    };
  }

  if (hasDatabaseConfig()) {
    return {
      mode: "database",
      apiBaseUrl: null,
      feed: (query) => getFeed(query),
      latestSummaries: () => getLatestWindowSummaries(),
      authorLocations: (limit) => getAuthorLocationSuggestions(limit),
      activityTrends: (query, options) =>
        getTrends(query, {
          applyTextQuery: options.searchMode !== "semantic",
          rangeKey: options.trendRange,
        }),
      postDetail: (statusId) => getPostDetail(statusId),
    };
  }

  return {
    mode: "unconfigured",
    apiBaseUrl: null,
    feed: async () => unconfigured(),
    latestSummaries: async () => unconfigured(),
    authorLocations: async () => unconfigured(),
    activityTrends: async () => unconfigured(),
    postDetail: async () => unconfigured(),
  };
}
