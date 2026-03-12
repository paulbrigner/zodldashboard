import Link from "next/link";
import type { CSSProperties } from "react";
import { LocalDateTime } from "@/app/components/local-date-time";
import type { TrendsResponse } from "@/lib/xmonitor/types";

type TrendRangeKey = "24h" | "7d" | "30d";

type TrendsPanelProps = {
  payload: TrendsResponse | null;
  error: string | null;
  rangeOptions: Array<{
    key: TrendRangeKey;
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

function formatBucketLabelForRange(iso: string, rangeKey: string | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");

  if (rangeKey === "24h") {
    return `${hour}:00`;
  }
  if (rangeKey === "7d" || rangeKey === "30d") {
    return `${month}/${day}`;
  }
  return `${month}/${day} ${hour}:00`;
}

function buildLabelIndexSet(total: number, maxLabels = 6): Set<number> {
  if (total <= 0) return new Set();
  if (total <= maxLabels) return new Set(Array.from({ length: total }, (_, index) => index));

  const indexes = new Set<number>([0, total - 1]);
  for (let i = 1; i < maxLabels - 1; i += 1) {
    const index = Math.round((i * (total - 1)) / (maxLabels - 1));
    indexes.add(index);
  }
  return indexes;
}

function compressTrendBuckets(
  buckets: TrendsResponse["activity"]["buckets"],
  maxBuckets: number
): TrendsResponse["activity"]["buckets"] {
  if (buckets.length <= maxBuckets) return buckets;
  const groupSize = Math.ceil(buckets.length / maxBuckets);
  const compressed: TrendsResponse["activity"]["buckets"] = [];
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
      watchlist_count: slice.reduce((sum, item) => sum + item.watchlist_count, 0),
      priority_count: slice.reduce((sum, item) => sum + item.priority_count, 0),
      discovery_count: slice.reduce((sum, item) => sum + item.discovery_count, 0),
      other_count: slice.reduce((sum, item) => sum + item.other_count, 0),
      unique_handle_count: slice.reduce((sum, item) => sum + item.unique_handle_count, 0),
    });
  }
  return compressed;
}

export function TrendsPanel({ payload, error, rangeOptions }: TrendsPanelProps) {
  const activity = payload?.activity || null;
  const totals = activity?.totals || null;
  const buckets = compressTrendBuckets(activity?.buckets || [], MAX_TREND_BUCKETS);
  const maxBucketPosts = Math.max(1, ...buckets.map((item) => item.post_count || 0));
  const labelIndexes = buildLabelIndexSet(buckets.length, 6);
  const trendCount = Math.max(1, buckets.length);
  const trendBarsStyle = {
    gridTemplateColumns: `repeat(${trendCount}, minmax(0, 1fr))`,
  } as CSSProperties;
  const statCards = totals
    ? [
        { label: "Posts", value: totals.post_count },
        { label: "Significant", value: totals.significant_count },
        { label: "Watchlist", value: totals.watchlist_count },
        { label: "Discovery", value: totals.discovery_count },
        { label: "Unique handles", value: totals.unique_handle_count },
      ]
    : [];

  return (
    <details className="trends-panel">
      <summary className="summary-panel-header">
        <span className="summary-panel-title-wrap">
          <span className="summary-panel-title">Trends</span>
          <span aria-hidden className="disclosure-caret">
            ▾
          </span>
        </span>
        <span className="summary-panel-state">{totals ? `${totals.post_count} posts` : "Unavailable"}</span>
      </summary>

      <div className="trends-panel-body">
        <div className="trend-range-row">
          <span className="subtle-text">Range</span>
          <div className="trend-range-chips">
            {rangeOptions.map((option) => (
              <Link className={`trend-range-chip ${option.active ? "trend-range-chip-active" : ""}`} href={option.href} key={option.key}>
                {option.label}
              </Link>
            ))}
          </div>
        </div>

        {payload ? (
          <p className="subtle-text">
            Scope <LocalDateTime iso={payload.scope.since} /> - <LocalDateTime iso={payload.scope.until} /> | bucket{" "}
            {payload.scope.bucket_hours}h | {formatNumber(payload.activity.totals.post_count)} posts
          </p>
        ) : null}

        {payload && !payload.scope.text_filter_applied ? (
          <p className="subtle-text">Semantic mode does not apply the free-text query filter to trends.</p>
        ) : null}

        {!totals ? <p className="subtle-text">No activity trends are available yet.</p> : null}

        <section className="trend-block">
          <h3>Activity trend</h3>
          {buckets.length > 0 ? (
            <div className="trend-chart-wrap">
              <div className="trend-bars" role="img" aria-label="Post activity over time" style={trendBarsStyle}>
                {buckets.map((bucket, index) => {
                  const heightPct = Math.max(6, Math.round((bucket.post_count / maxBucketPosts) * 100));
                  const showLabel = labelIndexes.has(index);
                  const title = [
                    `${formatBucketLabel(bucket.bucket_start)} UTC`,
                    `posts ${formatNumber(bucket.post_count)}`,
                    `significant ${formatNumber(bucket.significant_count)}`,
                    `watchlist ${formatNumber(bucket.watchlist_count)}`,
                    `priority ${formatNumber(bucket.priority_count)}`,
                    `discovery ${formatNumber(bucket.discovery_count)}`,
                    bucket.other_count > 0 ? `other ${formatNumber(bucket.other_count)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" | ");
                  return (
                    <div className="trend-col" key={`${bucket.bucket_start}:${index}`}>
                      <span className="trend-bar-wrap">
                        <span className="trend-bar" style={{ height: `${heightPct}%` }} title={title} />
                      </span>
                      <span className="trend-label">
                        {showLabel ? formatBucketLabelForRange(bucket.bucket_start, payload?.scope?.range_key) : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="subtle-text">No activity buckets are available for this scope.</p>
          )}
        </section>

        {totals ? (
          <section className="trend-block">
            <h3>Activity breakdown</h3>
            <div className="trend-stat-grid">
              {statCards.map((card) => (
                <article className="trend-stat-card" key={card.label}>
                  <p className="trend-stat-value">{formatNumber(card.value)}</p>
                  <p className="subtle-text trend-stat-label">{card.label}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </details>
  );
}
