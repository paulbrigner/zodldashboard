import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { canReadDashboard } from "@/lib/access-control";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { recordXMonitorAccess } from "@/lib/xmonitor-access-events";
import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { composeEnabled } from "@/lib/xmonitor/compose";
import { createXMonitorReadService } from "@/lib/xmonitor/read-service";
import { createQueryEmbedding, semanticEnabled } from "@/lib/xmonitor/semantic";
import type { SemanticQueryResponse } from "@/lib/xmonitor/types";
import type {
  ActivityTrendsResponse,
  FeedResponse,
  WindowSummary,
  XMonitorSearchMode,
  XMonitorTrendRangeKey,
} from "@xmonitor/core/contracts";
import { parseFeedQuery } from "@/lib/xmonitor/validators";
import { buildViewerProxyHeaders } from "@/lib/xmonitor/viewer-proxy";
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

const SUMMARY_WINDOW_TYPES = ["rolling_2h", "rolling_12h", "rolling_7d_daily"] as const;
type SearchMode = XMonitorSearchMode;
type TrendRangeKey = XMonitorTrendRangeKey;
type SignificantFilterMode = "default_true" | "any" | "true" | "false";
const MULTI_VALUE_FILTER_KEYS = new Set(["tier", "theme", "debate_issue"]);

const SUMMARY_LABELS: Record<(typeof SUMMARY_WINDOW_TYPES)[number], string> = {
  rolling_2h: "2-hour rolling summary",
  rolling_12h: "12-hour rolling summary",
  rolling_7d_daily: "Weekly summary",
};

const SUMMARY_DESCRIPTIONS: Record<(typeof SUMMARY_WINDOW_TYPES)[number], string> = {
  rolling_2h: "Latest short-window conversation summary.",
  rolling_12h: "Latest broader half-day summary.",
  rolling_7d_daily: "Trailing 7-day summary refreshed daily at 6:00 AM ET.",
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
  if (text === "24h" || text === "30d" || text === "90d") return text;
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
    "theme",
    "debate_issue",
    "handle",
    "min_followers",
    "max_followers",
    "min_account_age_days",
    "max_account_age_days",
    "location",
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
    if (MULTI_VALUE_FILTER_KEYS.has(String(key))) {
      for (const value of asStrings(params[key])) {
        query.append(String(key), value);
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
  query.themes?.forEach((theme) => params.append("theme", theme));
  query.debate_issues?.forEach((issue) => params.append("debate_issue", issue));
  if (query.handle) params.set("handle", query.handle);
  if (query.min_followers !== undefined) params.set("min_followers", String(query.min_followers));
  if (query.max_followers !== undefined) params.set("max_followers", String(query.max_followers));
  if (query.min_account_age_days !== undefined) params.set("min_account_age_days", String(query.min_account_age_days));
  if (query.max_account_age_days !== undefined) params.set("max_account_age_days", String(query.max_account_age_days));
  if (query.location) params.set("location", query.location);
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

function buildTrendRangeUrl(
  params: Record<string, string | string[] | undefined>,
  targetRange: TrendRangeKey,
  significantMode: SignificantFilterMode
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "cursor" || key === "engagement_range" || key === "significant") continue;
    if (MULTI_VALUE_FILTER_KEYS.has(key)) {
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

function buildFilterPanelKey(
  query: ReturnType<typeof parseFeedQuery>,
  searchMode: SearchMode,
  significantMode: SignificantFilterMode
): string {
  return JSON.stringify({
    searchMode,
    significantMode,
    since: query.since || "",
    until: query.until || "",
    tiers: query.tiers || [],
    themes: query.themes || [],
    debateIssues: query.debate_issues || [],
    handle: query.handle || "",
    minFollowers: query.min_followers || 0,
    maxFollowers: query.max_followers || 0,
    minAccountAgeDays: query.min_account_age_days || 0,
    maxAccountAgeDays: query.max_account_age_days || 0,
    location: query.location || "",
    q: query.q || "",
    limit: query.limit || 0,
  });
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

async function fetchSemanticViaApi(
  baseUrl: string,
  query: ReturnType<typeof parseFeedQuery>,
  viewer: { email: string; mode: "oauth" | "local-bypass" }
): Promise<FeedResponse> {
  if (!query.q) {
    return { items: [], next_cursor: null };
  }

  const viewerHeaders = buildViewerProxyHeaders(viewer);
  if (!viewerHeaders) {
    throw new Error("XMONITOR_USER_PROXY_SECRET is not configured");
  }

  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const vector = await createQueryEmbedding(query.q);
  const response = await fetch(`${normalizedBase}/query/semantic`, {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...viewerHeaders,
    },
    body: JSON.stringify({
      query_text: query.q,
      query_vector: vector,
      since: query.since,
      until: query.until,
      tiers: query.tiers,
      themes: query.themes,
      debate_issues: query.debate_issues,
      handle: query.handle,
      significant: query.significant,
      min_followers: query.min_followers,
      max_followers: query.max_followers,
      min_account_age_days: query.min_account_age_days,
      max_account_age_days: query.max_account_age_days,
      location: query.location,
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

export default async function HomePage({ searchParams }: HomePageProps) {
  const viewer = await requireAuthenticatedViewer("/x-monitor");
  if (!canReadDashboard(viewer, "x-monitor")) {
    redirect("/");
  }
  const requestHeaders = await headers();
  await recordXMonitorAccess({ viewer, headers: requestHeaders });

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
  const readService = createXMonitorReadService();
  const apiBaseUrl = readService.apiBaseUrl;
  const refreshUrl = buildRefreshUrl(query, searchMode, significantMode);
  const significantToggleUrl = buildSignificantToggleUrl(query, searchMode, significantMode);
  const pollUrl = buildPollUrl(query, useSemanticRetrieval, significantMode);

  let feed: FeedResponse = { items: [], next_cursor: null };
  let feedError: string | null = null;
  let summaries: WindowSummary[] = [];
  let summariesError: string | null = null;
  let trends: ActivityTrendsResponse | null = null;
  let trendsError: string | null = null;
  let locationSuggestions: string[] = [];

  if (readService.mode !== "unconfigured") {
    try {
      if (useSemanticRetrieval) {
        if (readService.mode !== "api" || !apiBaseUrl) {
          feedError = "Semantic mode requires XMONITOR_READ_API_BASE_URL/XMONITOR_BACKEND_API_BASE_URL.";
        } else if (!semanticAvailable) {
          feedError = "Semantic mode is disabled.";
        } else {
          feed = await fetchSemanticViaApi(apiBaseUrl, query, viewer);
        }
      } else {
        feed = await readService.feed(query);
      }
    } catch (error) {
      feedError = error instanceof Error ? error.message : "Failed to load feed";
    }

    try {
      summaries = await readService.latestSummaries();
    } catch (error) {
      summariesError = error instanceof Error ? error.message : "Failed to load summaries";
    }

    try {
      trends = await readService.activityTrends(query, { searchMode, trendRange });
    } catch (error) {
      trendsError = error instanceof Error ? error.message : "Failed to load trends";
    }

    try {
      locationSuggestions = await readService.authorLocations();
    } catch {
      locationSuggestions = [];
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
      (query.themes && query.themes.length > 0) ||
      (query.debate_issues && query.debate_issues.length > 0) ||
      query.handle ||
      query.min_followers !== undefined ||
      query.max_followers !== undefined ||
      query.min_account_age_days !== undefined ||
      query.max_account_age_days !== undefined ||
      query.location ||
      significantMode === "false" ||
      significantMode === "any" ||
      query.since ||
      query.until ||
      query.q ||
      (query.limit && query.limit !== 50)
  );
  const hasActiveFilters = searchMode === "semantic" ? Boolean(query.q) : keywordHasActiveFilters;
  const trendRangeOptions = (["24h", "7d", "30d", "90d"] as const).map((range) => ({
    key: range,
    label: range.toUpperCase(),
    href: buildTrendRangeUrl(params, range, significantMode),
    active: range === trendRange,
  }));
  const filterPanelKey = buildFilterPanelKey(query, searchMode, significantMode);

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
              {viewer.canSignOut ? <SignOutButton authProvider={viewer.authProvider || "next-auth"} /> : null}
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
          <div className="summary-panel-stack">
            {SUMMARY_WINDOW_TYPES.map((windowType) => {
              const summary = summariesByType.get(windowType);
              return (
                <details className="summary-subpanel" key={windowType}>
                  <summary className="summary-subpanel-header">
                    <span className="summary-subpanel-title-wrap">
                      <span className="summary-subpanel-title">{SUMMARY_LABELS[windowType]}</span>
                      <span aria-hidden className="disclosure-caret">
                        ▾
                      </span>
                    </span>
                    <span className="summary-subpanel-meta">
                      {summary ? (
                        <>
                          Generated <LocalDateTime iso={summary.generated_at} />
                        </>
                      ) : (
                        "Not generated yet"
                      )}
                    </span>
                  </summary>
                  <div className="summary-card">
                    <div className="summary-card-top">
                      <h3>{SUMMARY_LABELS[windowType]}</h3>
                      <p className="subtle-text summary-description">{SUMMARY_DESCRIPTIONS[windowType]}</p>
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
                  </div>
                </details>
              );
            })}
          </div>
          {summariesError ? <p className="error-text summary-error">{summariesError}</p> : null}
        </details>

        <TrendsPanel error={trendsError} payload={trends} rangeOptions={trendRangeOptions} />

        <FilterPanel
          key={filterPanelKey}
          initialDebateIssues={query.debate_issues}
          initialHandle={qsValue(query.handle)}
          initialHasActiveFilters={hasActiveFilters}
          initialLimit={query.limit || 50}
          initialLocation={qsValue(query.location)}
          initialMaxAccountAgeDays={query.max_account_age_days}
          initialMaxFollowers={query.max_followers}
          initialMinAccountAgeDays={query.min_account_age_days}
          initialMinFollowers={query.min_followers}
          initialQuery={qsValue(query.q)}
          initialSearchMode={searchMode}
          initialSignificant={query.significant}
          initialSince={query.since}
          initialThemes={query.themes}
          initialTiers={query.tiers}
          initialUntil={query.until}
          locationSuggestions={locationSuggestions}
        />

        <ComposePanel
          enabled={composePanelEnabled}
          emailEnabled={emailFeatureEnabled}
          emailSchedulesEnabled={emailSchedulesFeatureEnabled}
          initialHandle={query.handle}
          initialLocation={query.location}
          initialMaxAccountAgeDays={query.max_account_age_days}
          initialMaxFollowers={query.max_followers}
          initialMinAccountAgeDays={query.min_account_age_days}
          initialMinFollowers={query.min_followers}
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
