"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
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

const SUMMARY_THEME_COLORS: Record<string, string> = {
  "Governance / strategy": "#2f5bb5",
  "Privacy / freedom narrative": "#2f8f7b",
  "Market / price": "#9b6b1f",
  "Product / ecosystem": "#7c4db0",
  "Community / memes": "#d46a8d",
};

const SUMMARY_TIER_COLORS: Record<string, string> = {
  teammate: "#214ea8",
  investor: "#3a8a74",
  influencer: "#8b5db8",
  ecosystem: "#c57f24",
  other: "#91a0c2",
};

const DEBATE_POLARITY_COLORS = {
  pro: "#2f5bb5",
  contra: "#b84c67",
  mixed: "#6d7fa6",
  none: "#d9e4fb",
} as const;

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

function sumRecordValues(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, value) => sum + Number(value || 0), 0);
}

function sumMixTotals(
  labels: string[],
  buckets: Array<{ counts: Record<string, number> }>
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const label of labels) {
    totals[label] = 0;
  }
  for (const bucket of buckets) {
    for (const label of labels) {
      totals[label] += Number(bucket.counts[label] || 0);
    }
  }
  return totals;
}

function sumDebateTotals(
  labels: string[],
  buckets: TrendsResponse["summary"]["debate_trends"]["buckets"]
): Record<string, { mentions: number; pro: number; contra: number }> {
  const totals: Record<string, { mentions: number; pro: number; contra: number }> = {};
  for (const label of labels) {
    totals[label] = { mentions: 0, pro: 0, contra: 0 };
  }
  for (const bucket of buckets) {
    for (const label of labels) {
      const issue = bucket.issues[label];
      totals[label].mentions += Number(issue?.mentions || 0);
      totals[label].pro += Number(issue?.pro || 0);
      totals[label].contra += Number(issue?.contra || 0);
    }
  }
  return totals;
}

function formatCountBreakdown(labels: string[], counts: Record<string, number>): string {
  return labels
    .map((label) => `${label} ${formatNumber(counts[label] || 0)}`)
    .join(" | ");
}

function debateBarColor(issue: { mentions: number; pro: number; contra: number }): string {
  if (!issue.mentions) return DEBATE_POLARITY_COLORS.none;
  if (issue.pro > issue.contra) return DEBATE_POLARITY_COLORS.pro;
  if (issue.contra > issue.pro) return DEBATE_POLARITY_COLORS.contra;
  return DEBATE_POLARITY_COLORS.mixed;
}

function StackedTrendChart({
  buckets,
  labels,
  colorMap,
  rangeKey,
  formatTitle,
}: {
  buckets: TrendsResponse["summary"]["theme_mix"]["buckets"] | TrendsResponse["summary"]["tier_mix"]["buckets"];
  labels: string[];
  colorMap: Record<string, string>;
  rangeKey: string | undefined;
  formatTitle: (bucket: { bucket_start: string; counts: Record<string, number> }) => string;
}) {
  const labelIndexes = buildLabelIndexSet(buckets.length, 6);
  const chartStyle = {
    gridTemplateColumns: `repeat(${Math.max(1, buckets.length)}, minmax(0, 1fr))`,
  } as CSSProperties;

  return (
    <div className="trend-chart-wrap">
      <div className="stacked-trend-bars" style={chartStyle}>
        {buckets.map((bucket, index) => {
          const total = Math.max(0, labels.reduce((sum, label) => sum + Number(bucket.counts[label] || 0), 0));
          const showLabel = labelIndexes.has(index);
          return (
            <div className="stacked-trend-col" key={`${bucket.bucket_start}:${index}`}>
              <span className="stacked-trend-track" title={formatTitle(bucket)}>
                {total > 0 ? (
                  labels.map((label) => {
                    const value = Number(bucket.counts[label] || 0);
                    if (value <= 0) return null;
                    return (
                      <span
                        className="stacked-trend-segment"
                        key={label}
                        style={{
                          height: `${(value / total) * 100}%`,
                          background: colorMap[label] || "#91a0c2",
                        }}
                      />
                    );
                  })
                ) : (
                  <span className="stacked-trend-empty" />
                )}
              </span>
              <span className="trend-label">
                {showLabel ? formatBucketLabelForRange(bucket.bucket_start, rangeKey) : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DebateTrendCards({
  buckets,
  labels,
  rangeKey,
}: {
  buckets: TrendsResponse["summary"]["debate_trends"]["buckets"];
  labels: string[];
  rangeKey: string | undefined;
}) {
  const labelIndexes = buildLabelIndexSet(buckets.length, 6);
  const totals = sumDebateTotals(labels, buckets);
  const issues = labels
    .map((label) => ({
      label,
      totals: totals[label],
    }))
    .filter((item) => item.totals.mentions > 0);

  if (issues.length === 0) {
    return <p className="subtle-text">No tracked debate issues were active in this range.</p>;
  }

  return (
    <div className="debate-trend-grid">
      {issues.map((issue) => {
        const maxMentions = Math.max(1, ...buckets.map((bucket) => Number(bucket.issues[issue.label]?.mentions || 0)));
        const chartStyle = {
          gridTemplateColumns: `repeat(${Math.max(1, buckets.length)}, minmax(0, 1fr))`,
        } as CSSProperties;

        return (
          <article className="debate-trend-card" key={issue.label}>
            <div className="debate-trend-head">
              <h4>{issue.label}</h4>
              <p className="subtle-text debate-trend-metrics">
                {formatNumber(issue.totals.mentions)} mentions | {formatNumber(issue.totals.pro)} pro |{" "}
                {formatNumber(issue.totals.contra)} contra
              </p>
            </div>
            <div className="debate-trend-bars" style={chartStyle}>
              {buckets.map((bucket, index) => {
                const issueCounts = bucket.issues[issue.label] || { mentions: 0, pro: 0, contra: 0 };
                const mentions = Number(issueCounts.mentions || 0);
                const showLabel = labelIndexes.has(index);
                const heightPct = mentions > 0 ? Math.max(8, Math.round((mentions / maxMentions) * 100)) : 0;
                const title = [
                  `${formatBucketLabel(bucket.bucket_start)} UTC`,
                  `mentions ${formatNumber(mentions)}`,
                  `pro ${formatNumber(issueCounts.pro || 0)}`,
                  `contra ${formatNumber(issueCounts.contra || 0)}`,
                ].join(" | ");

                return (
                  <div className="debate-trend-col" key={`${issue.label}:${bucket.bucket_start}:${index}`}>
                    <span className="debate-trend-bar-wrap">
                      {mentions > 0 ? (
                        <span
                          className="debate-trend-bar"
                          style={{
                            height: `${heightPct}%`,
                            background: debateBarColor({
                              mentions,
                              pro: Number(issueCounts.pro || 0),
                              contra: Number(issueCounts.contra || 0),
                            }),
                          }}
                          title={title}
                        />
                      ) : (
                        <span className="debate-trend-empty" title={title} />
                      )}
                    </span>
                    <span className="trend-label">
                      {showLabel ? formatBucketLabelForRange(bucket.bucket_start, rangeKey) : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function TrendsPanel({ payload, error, rangeOptions }: TrendsPanelProps) {
  const [includeOtherTier, setIncludeOtherTier] = useState(true);
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

  const summary = payload?.summary || null;
  const summaryThemeBuckets = summary?.theme_mix.buckets || [];
  const summaryTierBuckets = summary?.tier_mix.buckets || [];
  const summaryDebateBuckets = summary?.debate_trends.buckets || [];
  const summaryHasData =
    summaryThemeBuckets.length > 0 || summaryTierBuckets.length > 0 || summaryDebateBuckets.length > 0;
  const summaryThemeTotals = summary ? sumMixTotals(summary.theme_mix.labels, summaryThemeBuckets) : {};
  const summaryTierLabels = summary?.tier_mix.labels || [];
  const visibleSummaryTierLabels = includeOtherTier ? summaryTierLabels : summaryTierLabels.filter((label) => label !== "other");
  const summaryTierTotals = summary ? sumMixTotals(summaryTierLabels, summaryTierBuckets) : {};

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
          <p className="subtle-text">Semantic mode does not apply the free-text query filter to activity trends.</p>
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

        <section className="trend-block">
          <h3>Conversation-wide summary trends</h3>
          {summary ? (
            <p className="subtle-text summary-trend-note">
              Uses precomputed 2-hour summaries and follows the selected time range only.
              {summary.scope.coverage_start && summary.scope.coverage_end ? (
                <>
                  {" "}
                  Coverage <LocalDateTime iso={summary.scope.coverage_start} /> -{" "}
                  <LocalDateTime iso={summary.scope.coverage_end} /> | displayed in {summary.scope.bucket_hours}h buckets.
                </>
              ) : null}
            </p>
          ) : null}

          {!summaryHasData ? <p className="subtle-text">No summary trend coverage is available for this range yet.</p> : null}

          {summaryHasData ? (
            <>
              <section className="trend-block summary-trend-block">
                <h3>Theme mix</h3>
                <StackedTrendChart
                  buckets={summaryThemeBuckets}
                  colorMap={SUMMARY_THEME_COLORS}
                  labels={summary?.theme_mix.labels || []}
                  rangeKey={payload?.scope?.range_key}
                  formatTitle={(bucket) =>
                    [`${formatBucketLabel(bucket.bucket_start)} UTC`, formatCountBreakdown(summary?.theme_mix.labels || [], bucket.counts)].join(
                      " | "
                    )
                  }
                />
                <div className="trend-legend">
                  {(summary?.theme_mix.labels || []).map((label) => (
                    <span className="trend-legend-item" key={label}>
                      <span
                        aria-hidden
                        className="trend-legend-swatch"
                        style={{ background: SUMMARY_THEME_COLORS[label] || "#91a0c2" }}
                      />
                      <span>
                        {label} ({formatNumber(summaryThemeTotals[label] || 0)})
                      </span>
                    </span>
                  ))}
                </div>
              </section>

              <section className="trend-block summary-trend-block">
                <h3>Debate intensity and polarity</h3>
                <div className="trend-legend">
                  <span className="trend-legend-item" key="debate-pro">
                    <span aria-hidden className="trend-legend-swatch" style={{ background: DEBATE_POLARITY_COLORS.pro }} />
                    <span>Pro-leading</span>
                  </span>
                  <span className="trend-legend-item" key="debate-contra">
                    <span aria-hidden className="trend-legend-swatch" style={{ background: DEBATE_POLARITY_COLORS.contra }} />
                    <span>Contra-leading</span>
                  </span>
                  <span className="trend-legend-item" key="debate-mixed">
                    <span aria-hidden className="trend-legend-swatch" style={{ background: DEBATE_POLARITY_COLORS.mixed }} />
                    <span>Even / mixed</span>
                  </span>
                  <span className="trend-legend-item" key="debate-none">
                    <span aria-hidden className="trend-legend-swatch" style={{ background: DEBATE_POLARITY_COLORS.none }} />
                    <span>No mentions in bucket</span>
                  </span>
                </div>
                <DebateTrendCards
                  buckets={summaryDebateBuckets}
                  labels={summary?.debate_trends.labels || []}
                  rangeKey={payload?.scope?.range_key}
                />
              </section>

              <section className="trend-block summary-trend-block">
                <h3>Tier mix</h3>
                <StackedTrendChart
                  buckets={summaryTierBuckets}
                  colorMap={SUMMARY_TIER_COLORS}
                  labels={visibleSummaryTierLabels}
                  rangeKey={payload?.scope?.range_key}
                  formatTitle={(bucket) =>
                    [`${formatBucketLabel(bucket.bucket_start)} UTC`, formatCountBreakdown(visibleSummaryTierLabels, bucket.counts)].join(
                      " | "
                    )
                  }
                />
                <div className="trend-legend">
                  {summaryTierLabels.map((label) =>
                    label === "other" ? (
                      <label className="trend-legend-item trend-legend-item-control" key={label}>
                        <input
                          checked={includeOtherTier}
                          className="trend-legend-checkbox"
                          onChange={(event) => setIncludeOtherTier(event.target.checked)}
                          type="checkbox"
                        />
                        <span
                          aria-hidden
                          className="trend-legend-swatch"
                          style={{ background: SUMMARY_TIER_COLORS[label] || "#91a0c2" }}
                        />
                        <span>
                          {label} ({formatNumber(summaryTierTotals[label] || 0)})
                        </span>
                      </label>
                    ) : (
                      <span className="trend-legend-item" key={label}>
                        <span
                          aria-hidden
                          className="trend-legend-swatch"
                          style={{ background: SUMMARY_TIER_COLORS[label] || "#91a0c2" }}
                        />
                        <span>
                          {label} ({formatNumber(summaryTierTotals[label] || 0)})
                        </span>
                      </span>
                    )
                  )}
                </div>
              </section>
            </>
          ) : null}
        </section>

        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </details>
  );
}
