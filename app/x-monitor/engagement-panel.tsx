import Link from "next/link";
import { LocalDateTime } from "@/app/components/local-date-time";
import type { EngagementResponse } from "@/lib/xmonitor/types";

type EngagementPanelProps = {
  payload: EngagementResponse | null;
  error: string | null;
};

const numberFormatter = new Intl.NumberFormat("en-US");

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

function tierLabel(tier: string): string {
  if (tier === "teammate") return "Teammate";
  if (tier === "influencer") return "Influencer";
  if (tier === "ecosystem") return "Ecosystem";
  return "Other";
}

function truncate(text: string | null | undefined, maxChars = 130): string {
  const source = (text || "").replace(/\s+/g, " ").trim();
  if (!source) return "(no text captured)";
  if (source.length <= maxChars) return source;
  return `${source.slice(0, maxChars - 1)}…`;
}

export function EngagementPanel({ payload, error }: EngagementPanelProps) {
  const totals = payload?.totals || null;
  const buckets = payload?.buckets || [];
  const tiers = payload?.by_tier || [];
  const topHandles = payload?.top_handles || [];
  const topPosts = payload?.top_posts || [];
  const maxBucketScore = Math.max(1, ...buckets.map((item) => item.engagement_score || 0));
  const maxTierScore = Math.max(1, ...tiers.map((item) => item.engagement_score || 0));
  const labelStep = Math.max(1, Math.ceil(buckets.length / 8));

  return (
    <details className="engagement-panel" open>
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
        {payload ? (
          <p className="subtle-text">
            Scope <LocalDateTime iso={payload.scope.since} /> - <LocalDateTime iso={payload.scope.until} /> | bucket{" "}
            {payload.scope.bucket_hours}h
          </p>
        ) : null}

        {totals ? (
          <div className="engagement-kpis">
            <article className="engagement-kpi">
              <p className="engagement-kpi-label">Posts</p>
              <p className="engagement-kpi-value">{formatNumber(totals.post_count)}</p>
            </article>
            <article className="engagement-kpi">
              <p className="engagement-kpi-label">Significant</p>
              <p className="engagement-kpi-value">{formatNumber(totals.significant_count)}</p>
            </article>
            <article className="engagement-kpi">
              <p className="engagement-kpi-label">Likes</p>
              <p className="engagement-kpi-value">{formatNumber(totals.likes)}</p>
            </article>
            <article className="engagement-kpi">
              <p className="engagement-kpi-label">Reposts</p>
              <p className="engagement-kpi-value">{formatNumber(totals.reposts)}</p>
            </article>
            <article className="engagement-kpi">
              <p className="engagement-kpi-label">Replies</p>
              <p className="engagement-kpi-value">{formatNumber(totals.replies)}</p>
            </article>
            <article className="engagement-kpi">
              <p className="engagement-kpi-label">Views</p>
              <p className="engagement-kpi-value">{formatNumber(totals.views)}</p>
            </article>
            <article className="engagement-kpi">
              <p className="engagement-kpi-label">Score</p>
              <p className="engagement-kpi-value">{formatNumber(totals.engagement_score)}</p>
            </article>
          </div>
        ) : (
          <p className="subtle-text">No engagement metrics are available yet.</p>
        )}

        <section className="engagement-block">
          <h3>Engagement trend</h3>
          {buckets.length > 0 ? (
            <div className="engagement-trend-wrap">
              <div className="engagement-trend-bars" role="img" aria-label="Engagement score over time">
                {buckets.map((bucket, index) => {
                  const heightPct = Math.max(7, Math.round((bucket.engagement_score / maxBucketScore) * 100));
                  const showLabel = index % labelStep === 0 || index === buckets.length - 1;
                  return (
                    <div className="engagement-trend-col" key={`${bucket.bucket_start}:${index}`}>
                      <span
                        className="engagement-trend-bar"
                        style={{ height: `${heightPct}%` }}
                        title={`${formatBucketLabel(bucket.bucket_start)} UTC | score ${formatNumber(
                          bucket.engagement_score
                        )} | posts ${bucket.post_count}`}
                      />
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

        <div className="engagement-split-grid">
          <section className="engagement-block">
            <h3>By tier</h3>
            {tiers.length > 0 ? (
              <ul className="engagement-tier-list">
                {tiers.map((tier) => {
                  const widthPct = Math.max(6, Math.round((tier.engagement_score / maxTierScore) * 100));
                  return (
                    <li className="engagement-tier-row" key={tier.watch_tier}>
                      <div className="engagement-tier-meta">
                        <span>{tierLabel(tier.watch_tier)}</span>
                        <span className="subtle-text">
                          {formatNumber(tier.post_count)} posts | score {formatNumber(tier.engagement_score)}
                        </span>
                      </div>
                      <div className="engagement-tier-track">
                        <span className="engagement-tier-fill" style={{ width: `${widthPct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="subtle-text">No tier data available.</p>
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
        </div>

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
