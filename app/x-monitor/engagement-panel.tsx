import Link from "next/link";
import type { CSSProperties } from "react";
import { LocalDateTime } from "@/app/components/local-date-time";
import type { EngagementResponse } from "@/lib/xmonitor/types";

type EngagementPanelProps = {
  payload: EngagementResponse | null;
  error: string | null;
  rangeOptions: Array<{
    key: "24h" | "7d" | "30d";
    label: string;
    href: string;
    active: boolean;
  }>;
};

const numberFormatter = new Intl.NumberFormat("en-US");
const MAX_TREND_BUCKETS = 48;

function formatNumber(value: number): string {
  return numberFormatter.format(Math.round(value));
}

function formatBucketLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${month}/${day} ${hour}:00`;
}

function truncate(text: string | null | undefined, maxChars = 130): string {
  const source = (text || "").replace(/\s+/g, " ").trim();
  if (!source) return "(no text captured)";
  if (source.length <= maxChars) return source;
  return `${source.slice(0, maxChars - 1)}…`;
}

function compressTrendBuckets(buckets: EngagementResponse["buckets"], maxBuckets: number): EngagementResponse["buckets"] {
  if (buckets.length <= maxBuckets) return buckets;
  const groupSize = Math.ceil(buckets.length / maxBuckets);
  const compressed: EngagementResponse["buckets"] = [];
  for (let start = 0; start < buckets.length; start += groupSize) {
    const slice = buckets.slice(start, start + groupSize);
    if (slice.length === 0) continue;
    const first = slice[0];
    const last = slice[slice.length - 1];
    compressed.push({
      bucket_start: first.bucket_start,
      bucket_end: last.bucket_end,
      post_count: slice.reduce((sum, item) => sum + item.post_count, 0),
      significant_count: slice.reduce((sum, item) => sum + item.significant_count, 0),
      likes: slice.reduce((sum, item) => sum + item.likes, 0),
      reposts: slice.reduce((sum, item) => sum + item.reposts, 0),
      replies: slice.reduce((sum, item) => sum + item.replies, 0),
      views: slice.reduce((sum, item) => sum + item.views, 0),
      engagement_score: slice.reduce((sum, item) => sum + item.engagement_score, 0),
    });
  }
  return compressed;
}

export function EngagementPanel({ payload, error, rangeOptions }: EngagementPanelProps) {
  const totals = payload?.totals || null;
  const buckets = compressTrendBuckets(payload?.buckets || [], MAX_TREND_BUCKETS);
  const topHandles = payload?.top_handles || [];
  const topPosts = payload?.top_posts || [];
  const maxBucketScore = Math.max(1, ...buckets.map((item) => item.engagement_score || 0));
  const labelStep = Math.max(1, Math.ceil(buckets.length / 6));
  const trendCount = Math.max(1, buckets.length);
  const trendBarsStyle = {
    gridTemplateColumns: `repeat(${trendCount}, minmax(0, 1fr))`,
  } as CSSProperties;

  return (
    <details className="engagement-panel">
      <summary className="summary-panel-header">
        <span className="summary-panel-title-wrap">
          <span className="summary-panel-title">Engagement</span>
          <span aria-hidden className="disclosure-caret">
            ▾
          </span>
        </span>
        <span className="summary-panel-state">{totals ? `${totals.post_count} posts` : "Unavailable"}</span>
      </summary>

      <div className="engagement-panel-body">
        <div className="engagement-range-row">
          <span className="subtle-text">Range</span>
          <div className="engagement-range-chips">
            {rangeOptions.map((option) => (
              <Link
                className={`engagement-range-chip ${option.active ? "engagement-range-chip-active" : ""}`}
                href={option.href}
                key={option.key}
              >
                {option.label}
              </Link>
            ))}
          </div>
        </div>

        {payload ? (
          <p className="subtle-text">
            Scope <LocalDateTime iso={payload.scope.since} /> - <LocalDateTime iso={payload.scope.until} /> | bucket{" "}
            {payload.scope.bucket_hours}h | {formatNumber(payload.totals.post_count)} posts
          </p>
        ) : null}

        {!totals ? <p className="subtle-text">No engagement metrics are available yet.</p> : null}

        <section className="engagement-block">
          <h3>Engagement trend</h3>
          {buckets.length > 0 ? (
            <div className="engagement-trend-wrap">
              <div
                className="engagement-trend-bars"
                role="img"
                aria-label="Engagement score over time"
                style={trendBarsStyle}
              >
                {buckets.map((bucket, index) => {
                  const heightPct = Math.max(6, Math.round((bucket.engagement_score / maxBucketScore) * 100));
                  const showLabel = index % labelStep === 0 || index === buckets.length - 1;
                  return (
                    <div className="engagement-trend-col" key={`${bucket.bucket_start}:${index}`}>
                      <span className="engagement-trend-bar-wrap">
                        <span
                          className="engagement-trend-bar"
                          style={{ height: `${heightPct}%` }}
                          title={`${formatBucketLabel(bucket.bucket_start)} UTC | score ${formatNumber(
                            bucket.engagement_score
                          )} | posts ${bucket.post_count}`}
                        />
                      </span>
                      <span className="engagement-trend-label">{showLabel ? formatBucketLabel(bucket.bucket_start) : ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="subtle-text">No trend buckets available for this scope.</p>
          )}
        </section>

        <section className="engagement-block">
          <h3>Top handles</h3>
          {topHandles.length > 0 ? (
            <ul className="engagement-handle-list">
              {topHandles.map((handle) => (
                <li key={handle.author_handle}>
                  <span>@{handle.author_handle}</span>
                  <span className="subtle-text">
                    score {formatNumber(handle.engagement_score)} | {formatNumber(handle.post_count)} posts
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="subtle-text">No handle ranking available.</p>
          )}
        </section>

        <section className="engagement-block">
          <h3>Top posts by engagement</h3>
          {topPosts.length > 0 ? (
            <ul className="engagement-post-list">
              {topPosts.map((post) => (
                <li className="engagement-post-item" key={post.status_id}>
                  <div className="engagement-post-top">
                    <p>
                      <strong>@{post.author_handle}</strong>{" "}
                      {post.watch_tier ? <span className="pill">{post.watch_tier}</span> : null}
                    </p>
                    <p className="subtle-text">score {formatNumber(post.engagement_score)}</p>
                  </div>
                  <p className="subtle-text">{truncate(post.body_text)}</p>
                  <p className="subtle-text">
                    {formatNumber(post.likes)} likes | {formatNumber(post.reposts)} reposts | {formatNumber(post.replies)} replies |{" "}
                    {formatNumber(post.views)} views
                  </p>
                  <div className="button-row">
                    <Link className="button button-small" href={`/posts/${post.status_id}`}>
                      View detail
                    </Link>
                    <a className="button button-secondary button-small" href={post.url} rel="noreferrer" target="_blank">
                      Open on X
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="subtle-text">No top posts available.</p>
          )}
        </section>

        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </details>
  );
}
