import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { readApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";
import { getFeed } from "@/lib/xmonitor/repository";
import type { FeedResponse } from "@/lib/xmonitor/types";
import { parseFeedQuery } from "@/lib/xmonitor/validators";
import { SignOutButton } from "./sign-out-button";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0] || undefined;
  return undefined;
}

function qsValue(value: string | undefined): string {
  return value ?? "";
}

function buildQuery(
  params: Record<string, string | string[] | undefined>,
  nextCursor: string
): string {
  const query = new URLSearchParams();
  const keys: Array<keyof typeof params> = ["since", "until", "tier", "handle", "significant", "q", "limit"];

  keys.forEach((key) => {
    const value = asString(params[key]);
    if (value) {
      query.set(String(key), value);
    }
  });

  query.set("cursor", nextCursor);
  return query.toString();
}

function buildFeedApiUrl(baseUrl: string, query: ReturnType<typeof parseFeedQuery>): string {
  const url = new URL("/feed", `${baseUrl}/`);

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

export default async function HomePage({ searchParams }: HomePageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/signin");
  }

  const params = (await searchParams) || {};
  const query = parseFeedQuery(params);
  const apiBaseUrl = readApiBaseUrl();

  let feed: FeedResponse = { items: [], next_cursor: null };
  let feedError: string | null = null;

  if (apiBaseUrl) {
    try {
      feed = await fetchFeedViaApi(apiBaseUrl, query);
    } catch (error) {
      feedError = error instanceof Error ? error.message : "Failed to load feed";
    }
  } else if (hasDatabaseConfig()) {
    try {
      feed = await getFeed(query);
    } catch (error) {
      feedError = error instanceof Error ? error.message : "Failed to load feed";
    }
  } else {
    feedError = "No feed backend configured. Set XMONITOR_READ_API_BASE_URL/XMONITOR_BACKEND_API_BASE_URL or DATABASE_URL/PG*.";
  }

  return (
    <main className="page feed-page">
      <section className="card feed-card">
        <header className="feed-header">
          <div>
            <p className="eyebrow">XMonitor Stream A</p>
            <h1>Feed</h1>
            <p className="subtle-text">Signed in as {session.user.email}</p>
          </div>
          <div className="button-row">
            <Link className="button button-secondary" href="/oauth-probe">
              OAuth probe
            </Link>
            <SignOutButton />
          </div>
        </header>

        <form className="filter-grid" method="GET">
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
            <span>Handle</span>
            <input name="handle" defaultValue={qsValue(query.handle)} placeholder="zodl" type="text" />
          </label>

          <label>
            <span>Significant</span>
            <select name="significant" defaultValue={query.significant === undefined ? "" : String(query.significant)}>
              <option value="">Either</option>
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          </label>

          <label>
            <span>From</span>
            <input name="since" defaultValue={qsValue(asString(params.since))} placeholder="2026-01-01T00:00:00Z" type="text" />
          </label>

          <label>
            <span>Until</span>
            <input name="until" defaultValue={qsValue(asString(params.until))} placeholder="2026-12-31T23:59:59Z" type="text" />
          </label>

          <label>
            <span>Text search</span>
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
            <Link className="button button-secondary" href="/">
              Reset
            </Link>
          </div>
        </form>

        {feedError ? <p className="error-text">{feedError}</p> : null}

        <div className="feed-meta">
          <p>{feed.items.length} item(s) loaded</p>
        </div>

        <ul className="feed-list">
          {feed.items.map((item) => (
            <li className="feed-item" key={item.status_id}>
              <div className="feed-item-top">
                <p className="feed-handle">@{item.author_handle}</p>
                <p className="subtle-text">{new Date(item.discovered_at).toLocaleString()}</p>
              </div>

              <p className="feed-body">{item.body_text || "(no text captured)"}</p>

              <div className="feed-tags">
                <span className="pill">tier: {item.watch_tier || "-"}</span>
                <span className="pill">significant: {item.is_significant ? "true" : "false"}</span>
                <span className="pill">likes: {item.likes}</span>
                <span className="pill">reposts: {item.reposts}</span>
                <span className="pill">replies: {item.replies}</span>
                <span className="pill">views: {item.views}</span>
              </div>

              <div className="button-row">
                <Link className="button" href={`/posts/${item.status_id}`}>
                  View detail
                </Link>
                <a className="button button-secondary" href={item.url} rel="noreferrer" target="_blank">
                  Open on X
                </a>
              </div>
            </li>
          ))}
        </ul>

        {feed.items.length === 0 && !feedError ? <p className="subtle-text">No posts matched your filters.</p> : null}

        {feed.next_cursor ? (
          <div className="pagination-row">
            <Link className="button" href={`/?${buildQuery(params, feed.next_cursor)}`}>
              Load older items
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
