import test from "node:test";
import assert from "node:assert/strict";
import {
  SUMMARY_DEBATE_LABELS,
  SUMMARY_THEME_LABELS,
  SUMMARY_TIER_LABELS,
  buildSummaryTrends,
} from "../shared/xmonitor/summary-trends.mjs";

function buildRow(overrides = {}) {
  return {
    window_start: "2026-03-10T00:00:00.000Z",
    window_end: "2026-03-10T02:00:00.000Z",
    post_count: 10,
    significant_count: 4,
    tier_counts_json: {
      teammate: 1,
      investor: 2,
      influencer: 3,
      ecosystem: 1,
      other: 3,
    },
    top_themes_json: [
      { theme: "Privacy / freedom narrative", count: 5 },
      { theme: "Market / price", count: 2 },
    ],
    debates_json: [
      { issue: "ZSA direction", mentions: 3, pro: 2, contra: 1 },
    ],
    ...overrides,
  };
}

test("buildSummaryTrends keeps 24h windows at 2h granularity", () => {
  const result = buildSummaryTrends(
    [
      buildRow(),
      buildRow({
        window_start: "2026-03-10T02:00:00.000Z",
        window_end: "2026-03-10T04:00:00.000Z",
        post_count: 6,
        significant_count: 1,
        top_themes_json: [{ theme: "Product / ecosystem", count: 4 }],
        debates_json: [{ issue: "Execution readiness", mentions: 2, pro: 1, contra: 0 }],
      }),
    ],
    {
      rangeKey: "24h",
      since: "2026-03-09T04:00:00.000Z",
      until: "2026-03-10T04:00:00.000Z",
    }
  );

  assert.equal(result.scope.bucket_hours, 2);
  assert.deepEqual(result.theme_mix.labels, SUMMARY_THEME_LABELS);
  assert.deepEqual(result.debate_trends.labels, SUMMARY_DEBATE_LABELS);
  assert.deepEqual(result.tier_mix.labels, SUMMARY_TIER_LABELS);
  assert.equal(result.theme_mix.buckets.length, 2);
  assert.equal(result.theme_mix.buckets[0].counts["Privacy / freedom narrative"], 5);
  assert.equal(result.theme_mix.buckets[1].counts["Product / ecosystem"], 4);
  assert.equal(result.debate_trends.buckets[0].issues["ZSA direction"].mentions, 3);
  assert.equal(result.debate_trends.buckets[1].issues["Execution readiness"].mentions, 2);
});

test("buildSummaryTrends aggregates 2h windows into 12h buckets for 7d range", () => {
  const rows = [];
  for (let index = 0; index < 6; index += 1) {
    const startHour = String(index * 2).padStart(2, "0");
    const endHour = String((index + 1) * 2).padStart(2, "0");
    rows.push(
      buildRow({
        window_start: `2026-03-10T${startHour}:00:00.000Z`,
        window_end: `2026-03-10T${endHour}:00:00.000Z`,
        post_count: 5,
        significant_count: 2,
        tier_counts_json: { other: 5 },
        top_themes_json: [{ theme: "Market / price", count: 1 }],
        debates_json: [{ issue: "Governance legitimacy", mentions: 1, pro: 0, contra: 1 }],
      })
    );
  }

  const result = buildSummaryTrends(rows, {
    rangeKey: "7d",
    since: "2026-03-03T00:00:00.000Z",
    until: "2026-03-10T12:00:00.000Z",
  });

  assert.equal(result.scope.bucket_hours, 12);
  assert.equal(result.theme_mix.buckets.length, 1);
  assert.equal(result.theme_mix.buckets[0].total_count, 6);
  assert.equal(result.theme_mix.buckets[0].counts["Market / price"], 6);
  assert.equal(result.tier_mix.buckets[0].counts.other, 30);
  assert.equal(result.debate_trends.buckets[0].issues["Governance legitimacy"].mentions, 6);
  assert.equal(result.debate_trends.buckets[0].issues["Governance legitimacy"].contra, 6);
});
