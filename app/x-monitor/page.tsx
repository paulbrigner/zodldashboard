import Link from "next/link";
import type { ReactNode } from "react";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { backendApiBaseUrl, readApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { composeEnabled } from "@/lib/xmonitor/compose";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";
import { getFeed, getLatestWindowSummaries, getTrends } from "@/lib/xmonitor/repository";
import { createQueryEmbedding, semanticEnabled } from "@/lib/xmonitor/semantic";
import type {
  FeedResponse,
  SemanticQueryResponse,
  TrendsResponse,
  WindowSummariesLatestResponse,
  WindowSummary,
} from "@/lib/xmonitor/types";
import { parseFeedQuery } from "@/lib/xmonitor/validators";
import { ComposePanel } from "./compose-panel";
import { FeedUpdateIndicator } from "./feed-update-indicator";
import { FilterPanel } from "./filter-panel";
import { QueryReferencePopup } from "./query-reference-popup";
import { TrendsPanel } from "./trends-panel";
import { SignOutButton } from "../sign-out-button";
import { LocalDateTime } from "../components/local-date-time";

export const runtime = "nodejs";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const SUMMARY_WINDOW_TYPES = ["rolling_2h", "rolling_12h"] as const;
type SearchMode = "keyword" | "semantic";
type TrendRangeKey = "24h" | "7d" | "30d";
type SignificantFilterMode = "default_true" | "any" | "true" | "false";

const SUMMARY_LABELS: Record<(typeof SUMMARY_WINDOW_TYPES)[number], string> = {
  rolling_2h: "2-hour rolling summary",
  rolling_12h: "12-hour rolling summary",
};

function asString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0] || undefined;
  return undefined;
}

function asStrings(value: string | string[] | undefined): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value.filter((item) => Boolean(item));
  return [];
}

function qsValue(value: string | undefined): string {
  return value ?? "";
}

function appendSignificantParam(params: URLSearchParams, mode: SignificantFilterMode): void {
  if (mode === "default_true" || mode === "true") {
    params.set("significant", "true");
    return;
  }
  if (mode === "false") {
    params.set("significant", "false");
    return;
  }
  params.set("significant", "");
}

function deriveSignificantFilterMode(
  params: Record<string, string | string[] | undefined>,
  significant: boolean | undefined
): SignificantFilterMode {
  if (params.significant === undefined) return "default_true";
  if (significant === true) return "true";
  if (significant === false) return "false";
  return "any";
}

function applyDefaultSignificant(
  query: ReturnType<typeof parseFeedQuery>,
  mode: SignificantFilterMode
): ReturnType<typeof parseFeedQuery> {
  if (mode !== "default_true") return query;
  return {
    ...query,
    significant: true,
  };
}

function renderSummaryTextWithHandleLinks(text: string) {
  const handlePattern = /@([A-Za-z0-9_]{1,15})\b/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = handlePattern.exec(text)) !== null) {
    const start = match.index;
    const end = handlePattern.lastIndex;
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    const handle = match[1];
    nodes.push(
      <a
        className="summary-handle-link"
        href={`https://x.com/${handle}`}
        key={`${handle}-${start}`}
        rel="noreferrer"
        target="_blank"
      >
        @{handle}
      </a>
    );
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function envFlag(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseSearchMode(value: string | string[] | undefined): SearchMode {
  const text = asString(value);
  return text === "semantic" ? "semantic" : "keyword";
}

function parseTrendRange(value: string | string[] | undefined): TrendRangeKey {
  const text = asString(value);
  if (text === "24h" || text === "30d") return text;
  return "7d";
}

function buildQuery(
  params: Record<string, string | string[] | undefined>,
  nextCursor: string,
  significantMode: SignificantFilterMode
): string {
  const query = new URLSearchParams();
  const keys: Array<keyof typeof params> = [
    "search_mode",
    "since",
    "until",
    "tier",
    "handle",
    "significant",
    "q",
    "limit",
    "trend_range",
  ];

  keys.forEach((key) => {
    if (key === "trend_range") {
      const value = asString(params.trend_range ?? params.engagement_range);
      if (value) {
        query.set(String(key), value);
      }
      return;
    }
    if (key === "significant") {
      return;
    }
    if (key === "tier") {
      for (const value of asStrings(params[key])) {
        query.append("tier", value);
      }
      return;
    }
    const value = asString(params[key]);
    if (value) {
      query.set(String(key), value);
    }
  });

  appendSignificantParam(query, significantMode);
  query.set("cursor", nextCursor);
  return query.toString();
}

function buildFilterSearchParams(
  query: ReturnType<typeof parseFeedQuery>,
  significantMode: SignificantFilterMode,
  limitOverride?: number
): URLSearchParams {
  const params = new URLSearchParams();

  if (query.since) params.set("since", query.since);
  if (query.until) params.set("until", query.until);
  query.tiers?.forEach((tier) => params.append("tier", tier));
  if (query.handle) params.set("handle", query.handle);
  appendSignificantParam(params, significantMode);
  if (query.q) params.set("q", query.q);

  const effectiveLimit = limitOverride ?? query.limit;
  if (effectiveLimit) params.set("limit", String(effectiveLimit));

  return params;
}

function buildRefreshUrl(
  query: ReturnType<typeof parseFeedQuery>,
  searchMode: SearchMode,
  significantMode: SignificantFilterMode
): string {
  const params = buildFilterSearchParams(query, significantMode);
  if (searchMode === "semantic") params.set("search_mode", "semantic");
  const serialized = params.toString();
  return serialized ? `/x-monitor?${serialized}` : "/x-monitor";
}

function buildSignificantToggleUrl(
  query: ReturnType<typeof parseFeedQuery>,
  searchMode: SearchMode,
  significantMode: SignificantFilterMode
): string {
  const params = buildFilterSearchParams(query, significantMode);
  if (significantMode === "default_true" || significantMode === "true") {
    params.set("significant", "");
  } else {
    params.set("significant", "true");
  }
  if (searchMode === "semantic") params.set("search_mode", "semantic");
  const serialized = params.toString();
  return serialized ? `/x-monitor?${serialized}` : "/x-monitor";
}

function buildPollUrl(
  query: ReturnType<typeof parseFeedQuery>,
  useSemanticRetrieval: boolean,
  significantMode: SignificantFilterMode
): string {
  if (useSemanticRetrieval) {
    return "";
  }
  const params = buildFilterSearchParams(query, significantMode, 1);
  return `/api/v1/feed?${params.toString()}`;
}

function buildFeedApiUrl(
  baseUrl: string,
  query: ReturnType<typeof parseFeedQuery>,
  significantMode: SignificantFilterMode
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${normalizedBase}/feed`);

  if (query.since) url.searchParams.set("since", query.since);
  if (query.until) url.searchParams.set("until", query.until);
  query.tiers?.forEach((tier) => url.searchParams.append("tier", tier));
  if (query.handle) url.searchParams.set("handle", query.handle);
  appendSignificantParam(url.searchParams, significantMode);
  if (query.q) url.searchParams.set("q", query.q);
  if (query.limit) url.searchParams.set("limit", String(query.limit));
  if (query.cursor) url.searchParams.set("cursor", query.cursor);

  return url.toString();
}

function buildWindowSummariesApiUrl(baseUrl: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}/window-summaries/latest`;
}

function buildTrendsApiUrl(
  baseUrl: string,
  query: ReturnType<typeof parseFeedQuery>,
  searchMode: SearchMode,
  trendRange: TrendRangeKey,
  significantMode: SignificantFilterMode
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${normalizedBase}/trends`);

  if (query.since) url.searchParams.set("since", query.since);
  if (query.until) url.searchParams.set("until", query.until);
  query.tiers?.forEach((tier) => url.searchParams.append("tier", tier));
  if (query.handle) url.searchParams.set("handle", query.handle);
  appendSignificantParam(url.searchParams, significantMode);
  if (query.q) url.searchParams.set("q", query.q);
  if (searchMode === "semantic") url.searchParams.set("search_mode", "semantic");
  url.searchParams.set("trend_range", trendRange);

  return url.toString();
}

function buildTrendRangeUrl(
  params: Record<string, string | string[] | undefined>,
  targetRange: TrendRangeKey,
  significantMode: SignificantFilterMode
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "cursor" || key === "engagement_range" || key === "significant") continue;
    if (key === "tier") {
      for (const text of asStrings(value)) {
        query.append(key, text);
      }
      continue;
    }
    const text = asString(value);
    if (text) {
      query.set(key, text);
    }
  }
  appendSignificantParam(query, significantMode);
  query.set("trend_range", targetRange);
  const serialized = query.toString();
  return serialized ? `/x-monitor?${serialized}` : "/x-monitor";
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // fall through
  }
  return `API request failed (${response.status})`;
}

async function fetchFeedViaApi(
  baseUrl: string,
  query: ReturnType<typeof parseFeedQuery>,
  significantMode: SignificantFilterMode
): Promise<FeedResponse> {
  const response = await fetch(buildFeedApiUrl(baseUrl, query, significantMode), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const payload = (await response.json()) as FeedResponse;
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error("Invalid feed response payload");
  }

  return {
    items: payload.items,
    next_cursor: payload.next_cursor || null,
  };
}

async function fetchSemanticViaApi(baseUrl: string, query: ReturnType<typeof parseFeedQuery>): Promise<FeedResponse> {
  if (!query.q) {
    return { items: [], next_cursor: null };
  }

  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const vector = await createQueryEmbedding(query.q);
  const response = await fetch(`${normalizedBase}/query/semantic`, {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query_text: query.q,
      query_vector: vector,
      since: query.since,
      until: query.until,
      tiers: query.tiers,
      handle: query.handle,
      significant: query.significant,
      limit: query.limit,
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const payload = (await response.json()) as SemanticQueryResponse;
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error("Invalid semantic query response payload");
  }

  return {
    items: payload.items,
    next_cursor: null,
  };
}

async function fetchWindowSummariesViaApi(baseUrl: string): Promise<WindowSummary[]> {
  const response = await fetch(buildWindowSummariesApiUrl(baseUrl), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const payload = (await response.json()) as WindowSummariesLatestResponse;
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error("Invalid window summary response payload");
  }

  return payload.items;
}

async function fetchTrendsViaApi(
  baseUrl: string,
  query: ReturnType<typeof parseFeedQuery>,
  searchMode: SearchMode,
  trendRange: TrendRangeKey,
  significantMode: SignificantFilterMode
): Promise<TrendsResponse> {
  const response = await fetch(buildTrendsApiUrl(baseUrl, query, searchMode, trendRange, significantMode), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const payload = (await response.json()) as TrendsResponse;
  if (!payload || !payload.activity?.totals || !Array.isArray(payload.activity?.buckets)) {
    throw new Error("Invalid trends response payload");
  }

  return payload;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const viewer = await requireAuthenticatedViewer("/x-monitor");
  const identityText =
    viewer.mode === "local-bypass"
      ? `Local network bypass active (${viewer.bypassClientIp || "unknown IP"})`
      : `Signed in as ${viewer.email}`;

  const params = (await searchParams) || {};
  const parsedQuery = parseFeedQuery(params);
  const significantMode = deriveSignificantFilterMode(params, parsedQuery.significant);
  const query = applyDefaultSignificant(parsedQuery, significantMode);
  const semanticAvailable = semanticEnabled();
  const composeFeatureEnabled = composeEnabled();
  const composeBackendConfigured = Boolean(backendApiBaseUrl());
  const composePanelEnabled = composeFeatureEnabled && semanticAvailable && composeBackendConfigured;
  const emailFeatureEnabled = envFlag(process.env.XMONITOR_EMAIL_ENABLED, false) && viewer.mode === "oauth";
  const emailSchedulesFeatureEnabled =
    emailFeatureEnabled && envFlag(process.env.XMONITOR_EMAIL_SCHEDULES_ENABLED, false);
  const composeUnavailableReason = !composeFeatureEnabled
    ? "Compose mode is disabled by XMONITOR_COMPOSE_ENABLED."
    : !semanticAvailable
      ? "Compose mode requires semantic mode to be enabled."
      : !composeBackendConfigured
        ? "Compose mode requires XMONITOR_BACKEND_API_BASE_URL."
        : null;
  const searchMode = parseSearchMode(params.search_mode);
  const trendRange = parseTrendRange(params.trend_range ?? params.engagement_range);
  const useSemanticRetrieval = searchMode === "semantic" && Boolean(query.q);
  const apiBaseUrl = readApiBaseUrl();
  const refreshUrl = buildRefreshUrl(query, searchMode, significantMode);
  const significantToggleUrl = buildSignificantToggleUrl(query, searchMode, significantMode);
  const pollUrl = buildPollUrl(query, useSemanticRetrieval, significantMode);

  let feed: FeedResponse = { items: [], next_cursor: null };
  let feedError: string | null = null;
  let summaries: WindowSummary[] = [];
  let summariesError: string | null = null;
  let trends: TrendsResponse | null = null;
  let trendsError: string | null = null;

  if (apiBaseUrl) {
    try {
      if (useSemanticRetrieval) {
        if (!semanticAvailable) {
          feedError = "Semantic mode is disabled.";
        } else {
          feed = await fetchSemanticViaApi(apiBaseUrl, query);
        }
      } else {
        feed = await fetchFeedViaApi(apiBaseUrl, query, significantMode);
      }
    } catch (error) {
      feedError = error instanceof Error ? error.message : "Failed to load feed";
    }

    try {
      summaries = await fetchWindowSummariesViaApi(apiBaseUrl);
    } catch (error) {
      summariesError = error instanceof Error ? error.message : "Failed to load summaries";
    }

    try {
      trends = await fetchTrendsViaApi(apiBaseUrl, query, searchMode, trendRange, significantMode);
    } catch (error) {
      trendsError = error instanceof Error ? error.message : "Failed to load trends";
    }
  } else if (hasDatabaseConfig()) {
    try {
      if (useSemanticRetrieval) {
        feedError = "Semantic mode requires XMONITOR_READ_API_BASE_URL/XMONITOR_BACKEND_API_BASE_URL.";
      } else {
        feed = await getFeed(query);
      }
    } catch (error) {
      feedError = error instanceof Error ? error.message : "Failed to load feed";
    }

    try {
      summaries = await getLatestWindowSummaries();
    } catch (error) {
      summariesError = error instanceof Error ? error.message : "Failed to load summaries";
    }

    try {
      trends = await getTrends(query, {
        applyTextQuery: searchMode !== "semantic",
        rangeKey: trendRange,
      });
    } catch (error) {
      trendsError = error instanceof Error ? error.message : "Failed to load trends";
    }
  } else {
    feedError = "No feed backend configured. Set XMONITOR_READ_API_BASE_URL/XMONITOR_BACKEND_API_BASE_URL or DATABASE_URL/PG*.";
    summariesError = "No summary backend configured. Set XMONITOR_READ_API_BASE_URL/XMONITOR_BACKEND_API_BASE_URL or DATABASE_URL/PG*.";
    trendsError = "No trends backend configured. Set XMONITOR_READ_API_BASE_URL/XMONITOR_BACKEND_API_BASE_URL or DATABASE_URL/PG*.";
  }

  const latestItem = feed.items[0];
  const initialLatestKey = latestItem ? `${latestItem.discovered_at}|${latestItem.status_id}` : null;
  const summariesByType = new Map(summaries.map((summary) => [summary.window_type, summary]));
  const keywordHasActiveFilters = Boolean(
    (query.tiers && query.tiers.length > 0) ||
      query.handle ||
      significantMode === "false" ||
      significantMode === "any" ||
      query.since ||
      query.until ||
      query.q ||
      (query.limit && query.limit !== 50)
  );
  const hasActiveFilters = searchMode === "semantic" ? Boolean(query.q) : keywordHasActiveFilters;
  const trendRangeOptions = (["24h", "7d", "30d"] as const).map((range) => ({
    key: range,
    label: range.toUpperCase(),
    href: buildTrendRangeUrl(params, range, significantMode),
    active: range === trendRange,
  }));

  return (
    <main className="page feed-page">
      <section className="card feed-card">
        <header className="feed-header">
          <div>
            <p className="eyebrow">ZODL Team Dashboards</p>
            <h1>X Monitor</h1>
            <p className="subtle-text">{identityText}</p>
          </div>
          <div className="feed-header-actions">
            <div className="button-row">
              <Link className="button button-secondary" href="/">
                All dashboards
              </Link>
              {viewer.canSignOut ? <SignOutButton /> : null}
            </div>
            <div className="header-aux-row">
              <QueryReferencePopup />
            </div>
          </div>
        </header>

        <details className="summary-panel">
          <summary className="summary-panel-header">
            <span className="summary-panel-title-wrap">
              <span className="summary-panel-title">Summaries</span>
              <span aria-hidden className="disclosure-caret">
                ▾
              </span>
            </span>
            <span className="summary-panel-state">{summaries.length} loaded</span>
          </summary>
          <div className="summary-panel-grid">
            {SUMMARY_WINDOW_TYPES.map((windowType) => {
              const summary = summariesByType.get(windowType);
              return (
                <article className="summary-card" key={windowType}>
                  <div className="summary-card-top">
                    <h3>{SUMMARY_LABELS[windowType]}</h3>
                    {summary ? (
                      <p className="subtle-text">
                        Generated <LocalDateTime iso={summary.generated_at} />
                      </p>
                    ) : null}
                  </div>
                  {summary ? (
                    <>
                      <p className="subtle-text summary-window">
                        Window <LocalDateTime iso={summary.window_start} /> -{" "}
                        <LocalDateTime iso={summary.window_end} />
                      </p>
                      <p className="subtle-text summary-counts">
                        {summary.post_count} posts, {summary.significant_count} significant
                      </p>
                      <p className="summary-text">{renderSummaryTextWithHandleLinks(summary.summary_text)}</p>
                    </>
                  ) : (
                    <p className="subtle-text summary-empty">No summary available yet for this window.</p>
                  )}
                </article>
              );
            })}
          </div>
          {summariesError ? <p className="error-text summary-error">{summariesError}</p> : null}
        </details>

        <TrendsPanel error={trendsError} payload={trends} rangeOptions={trendRangeOptions} />

        <FilterPanel
          initialHandle={qsValue(query.handle)}
          initialHasActiveFilters={hasActiveFilters}
          initialLimit={query.limit || 50}
          initialQuery={qsValue(query.q)}
          initialSearchMode={searchMode}
          initialSignificant={query.significant}
          initialSince={query.since}
          initialTiers={query.tiers}
          initialUntil={query.until}
        />

        <ComposePanel
          enabled={composePanelEnabled}
          emailEnabled={emailFeatureEnabled}
          emailSchedulesEnabled={emailSchedulesFeatureEnabled}
          initialHandle={query.handle}
          initialSignificant={query.significant}
          initialSince={query.since}
          initialTiers={query.tiers}
          initialUntil={query.until}
          viewerAccessLevel={viewer.accessLevel}
          viewerEmail={viewer.email}
          unavailableReason={composeUnavailableReason}
        />

        {feedError ? <p className="error-text">{feedError}</p> : null}
        <div className="feed-meta-row">
          <p>{feed.items.length} item(s) loaded</p>
          {!feedError && !useSemanticRetrieval ? (
            <FeedUpdateIndicator
              initialLatestKey={initialLatestKey}
              pollUrl={pollUrl}
              refreshUrl={refreshUrl}
              significantOnly={query.significant === true}
              significantToggleUrl={significantToggleUrl}
            />
          ) : null}
        </div>

        <ul className="feed-list">
          {feed.items.map((item) => (
            <li className="feed-item" key={item.status_id}>
              <div className="feed-item-top">
                <p className="feed-handle">@{item.author_handle}</p>
                <div className="feed-item-meta-right">
                  {item.score !== undefined && item.score !== null ? (
                    <p className="subtle-text">score {item.score.toFixed(3)}</p>
                  ) : null}
                  <p className="subtle-text">
                    <LocalDateTime iso={item.discovered_at} />
                  </p>
                </div>
              </div>

              <p className="feed-body">{item.body_text || "(no text captured)"}</p>

              <div className="feed-item-actions">
                <Link className="button button-small" href={`/posts/${item.status_id}`}>
                  View detail
                </Link>
                <a className="button button-secondary button-small" href={item.url} rel="noreferrer" target="_blank">
                  Open on X
                </a>
              </div>
            </li>
          ))}
        </ul>

        {feed.items.length === 0 && !feedError ? <p className="subtle-text">No posts matched your filters.</p> : null}

        {!useSemanticRetrieval && feed.next_cursor ? (
          <div className="pagination-row">
            <Link className="button" href={`/x-monitor?${buildQuery(params, feed.next_cursor, significantMode)}`}>
              Load older items
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
