import Link from "next/link";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { readApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";
import { getFeed, getLatestWindowSummaries } from "@/lib/xmonitor/repository";
import { createQueryEmbedding, semanticEnabled } from "@/lib/xmonitor/semantic";
import type { FeedResponse, SemanticQueryResponse, WindowSummariesLatestResponse, WindowSummary } from "@/lib/xmonitor/types";
import { parseFeedQuery } from "@/lib/xmonitor/validators";
import { FeedUpdateIndicator } from "./feed-update-indicator";
import { DateRangeFields } from "./date-range-fields";
import { QueryReferencePopup } from "./query-reference-popup";
import { SignOutButton } from "../sign-out-button";
import { LocalDateTime } from "../components/local-date-time";

export const runtime = "nodejs";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const SUMMARY_WINDOW_TYPES = ["rolling_2h", "rolling_12h"] as const;
type SearchMode = "keyword" | "semantic";

const SUMMARY_LABELS: Record<(typeof SUMMARY_WINDOW_TYPES)[number], string> = {
  rolling_2h: "2-hour rolling summary",
  rolling_12h: "12-hour rolling summary",
};

function asString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0] || undefined;
  return undefined;
}

function qsValue(value: string | undefined): string {
  return value ?? "";
}

function parseSearchMode(value: string | string[] | undefined): SearchMode {
  const text = asString(value);
  return text === "semantic" ? "semantic" : "keyword";
}

function buildQuery(
  params: Record<string, string | string[] | undefined>,
  nextCursor: string
): string {
  const query = new URLSearchParams();
  const keys: Array<keyof typeof params> = ["search_mode", "since", "until", "tier", "handle", "significant", "q", "limit"];

  keys.forEach((key) => {
    const value = asString(params[key]);
    if (value) {
      query.set(String(key), value);
    }
  });

  query.set("cursor", nextCursor);
  return query.toString();
}

function buildFilterSearchParams(query: ReturnType<typeof parseFeedQuery>, limitOverride?: number): URLSearchParams {
  const params = new URLSearchParams();

  if (query.since) params.set("since", query.since);
  if (query.until) params.set("until", query.until);
  if (query.tier) params.set("tier", query.tier);
  if (query.handle) params.set("handle", query.handle);
  if (query.significant !== undefined) params.set("significant", String(query.significant));
  if (query.q) params.set("q", query.q);

  const effectiveLimit = limitOverride ?? query.limit;
  if (effectiveLimit) params.set("limit", String(effectiveLimit));

  return params;
}

function buildRefreshUrl(query: ReturnType<typeof parseFeedQuery>, searchMode: SearchMode): string {
  const params = buildFilterSearchParams(query);
  if (searchMode === "semantic") params.set("search_mode", "semantic");
  const serialized = params.toString();
  return serialized ? `/x-monitor?${serialized}` : "/x-monitor";
}

function buildPollUrl(query: ReturnType<typeof parseFeedQuery>, searchMode: SearchMode): string {
  if (searchMode === "semantic") {
    return "";
  }
  const params = buildFilterSearchParams(query, 1);
  return `/api/v1/feed?${params.toString()}`;
}

function buildFeedApiUrl(baseUrl: string, query: ReturnType<typeof parseFeedQuery>): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${normalizedBase}/feed`);

  if (query.since) url.searchParams.set("since", query.since);
  if (query.until) url.searchParams.set("until", query.until);
  if (query.tier) url.searchParams.set("tier", query.tier);
  if (query.handle) url.searchParams.set("handle", query.handle);
  if (query.significant !== undefined) url.searchParams.set("significant", String(query.significant));
  if (query.q) url.searchParams.set("q", query.q);
  if (query.limit) url.searchParams.set("limit", String(query.limit));
  if (query.cursor) url.searchParams.set("cursor", query.cursor);

  return url.toString();
}

function buildWindowSummariesApiUrl(baseUrl: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}/window-summaries/latest`;
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

async function fetchFeedViaApi(baseUrl: string, query: ReturnType<typeof parseFeedQuery>): Promise<FeedResponse> {
  const response = await fetch(buildFeedApiUrl(baseUrl, query), {
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
      tier: query.tier,
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

export default async function HomePage({ searchParams }: HomePageProps) {
  const viewer = await requireAuthenticatedViewer("/x-monitor");
  const identityText =
    viewer.mode === "local-bypass"
      ? `Local network bypass active (${viewer.bypassClientIp || "unknown IP"})`
      : `Signed in as ${viewer.email}`;

  const params = (await searchParams) || {};
  const query = parseFeedQuery(params);
  const searchMode = parseSearchMode(params.search_mode);
  const apiBaseUrl = readApiBaseUrl();
  const refreshUrl = buildRefreshUrl(query, searchMode);
  const pollUrl = buildPollUrl(query, searchMode);

  let feed: FeedResponse = { items: [], next_cursor: null };
  let feedError: string | null = null;
  let summaries: WindowSummary[] = [];
  let summariesError: string | null = null;

  if (apiBaseUrl) {
    try {
      if (searchMode === "semantic") {
        if (!semanticEnabled()) {
          feedError = "Semantic mode is disabled.";
        } else if (!query.q) {
          feed = { items: [], next_cursor: null };
        } else {
          feed = await fetchSemanticViaApi(apiBaseUrl, query);
        }
      } else {
        feed = await fetchFeedViaApi(apiBaseUrl, query);
      }
    } catch (error) {
      feedError = error instanceof Error ? error.message : "Failed to load feed";
    }

    try {
      summaries = await fetchWindowSummariesViaApi(apiBaseUrl);
    } catch (error) {
      summariesError = error instanceof Error ? error.message : "Failed to load summaries";
    }
  } else if (hasDatabaseConfig()) {
    try {
      if (searchMode === "semantic") {
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
  } else {
    feedError = "No feed backend configured. Set XMONITOR_READ_API_BASE_URL/XMONITOR_BACKEND_API_BASE_URL or DATABASE_URL/PG*.";
    summariesError = "No summary backend configured. Set XMONITOR_READ_API_BASE_URL/XMONITOR_BACKEND_API_BASE_URL or DATABASE_URL/PG*.";
  }

  const latestItem = feed.items[0];
  const initialLatestKey = latestItem ? `${latestItem.discovered_at}|${latestItem.status_id}` : null;
  const summariesByType = new Map(summaries.map((summary) => [summary.window_type, summary]));
  const hasActiveFilters = Boolean(
    query.tier ||
      query.handle ||
      query.significant !== undefined ||
      query.since ||
      query.until ||
      query.q ||
      (query.limit && query.limit !== 50) ||
      searchMode === "semantic"
  );

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
                      <p className="summary-text">{summary.summary_text}</p>
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

        <details className="filter-panel">
          <summary className="filter-summary">
            <span className="filter-summary-title-wrap">
              <span className="filter-summary-title">Filters</span>
              <span aria-hidden className="disclosure-caret">
                ▾
              </span>
            </span>
            {hasActiveFilters ? (
              <div className="filter-summary-controls">
                <span className="filter-summary-state">Active</span>
              </div>
            ) : null}
          </summary>

          <form className="filter-grid" method="GET">
            <label>
              <span>Search mode</span>
              <select name="search_mode" defaultValue={searchMode}>
                <option value="keyword">Keyword</option>
                <option value="semantic">Semantic</option>
              </select>
            </label>

            <label>
              <span>Tier</span>
              <select name="tier" defaultValue={query.tier || ""}>
                <option value="">All tiers</option>
                <option value="teammate">Teammate</option>
                <option value="influencer">Influencer</option>
                <option value="ecosystem">Ecosystem</option>
              </select>
            </label>

            <label>
              <span>HANDLE(S)</span>
              <input
                name="handle"
                defaultValue={qsValue(query.handle)}
                placeholder="zodl in4crypto @mert"
                type="text"
              />
            </label>

            <label>
              <span>Significant</span>
              <select name="significant" defaultValue={query.significant === undefined ? "" : String(query.significant)}>
                <option value="">Either</option>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            </label>

            <DateRangeFields initialSince={query.since} initialUntil={query.until} />

            <label>
              <span>{searchMode === "semantic" ? "Semantic query" : "Text search"}</span>
              <input name="q" defaultValue={qsValue(query.q)} placeholder="keyword" type="text" />
            </label>

            <label>
              <span>Limit</span>
              <input name="limit" defaultValue={String(query.limit || 50)} max={200} min={1} step={1} type="number" />
            </label>

            <div className="filter-actions">
              <button className="button" type="submit">
                Apply filters
              </button>
              <Link className="button button-secondary" href="/x-monitor">
                Reset
              </Link>
            </div>
          </form>
        </details>

        {feedError ? <p className="error-text">{feedError}</p> : null}
        <div className="feed-meta-row">
          <p>{feed.items.length} item(s) loaded</p>
          {!feedError && searchMode !== "semantic" ? (
            <FeedUpdateIndicator
              initialLatestKey={initialLatestKey}
              pollUrl={pollUrl}
              refreshUrl={refreshUrl}
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

        {searchMode !== "semantic" && feed.next_cursor ? (
          <div className="pagination-row">
            <Link className="button" href={`/x-monitor?${buildQuery(params, feed.next_cursor)}`}>
              Load older items
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
