import { SUMMARY_DEBATE_LABELS, SUMMARY_THEME_LABELS } from "./summary-taxonomy.mjs";

export { SUMMARY_DEBATE_LABELS, SUMMARY_THEME_LABELS } from "./summary-taxonomy.mjs";

const TWO_HOUR_BUCKET_HOURS = 2;

export const SUMMARY_TIER_LABELS = ["teammate", "investor", "influencer", "ecosystem", "other"];

function asFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoString(value) {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function createCountRecord(labels) {
  const record = {};
  for (const label of labels) {
    record[label] = 0;
  }
  return record;
}

function createDebateRecord() {
  const record = {};
  for (const label of SUMMARY_DEBATE_LABELS) {
    record[label] = { mentions: 0, pro: 0, contra: 0 };
  }
  return record;
}

function sumRecordValues(record) {
  return Object.values(record || {}).reduce((sum, value) => sum + asFiniteNumber(value), 0);
}

function alignBucketStartMs(iso, bucketHours) {
  const parsed = new Date(String(iso || ""));
  if (Number.isNaN(parsed.getTime())) return null;
  const bucketMs = Math.max(1, bucketHours) * 60 * 60 * 1000;
  return Math.floor(parsed.getTime() / bucketMs) * bucketMs;
}

function normalizeTierCounts(input) {
  const counts = createCountRecord(SUMMARY_TIER_LABELS);
  if (!input || typeof input !== "object") return counts;
  for (const [key, value] of Object.entries(input)) {
    const normalized = String(key || "").trim().toLowerCase();
    if (!SUMMARY_TIER_LABELS.includes(normalized)) continue;
    counts[normalized] += asFiniteNumber(value);
  }
  return counts;
}

function normalizeThemeCounts(input) {
  const counts = createCountRecord(SUMMARY_THEME_LABELS);
  if (!Array.isArray(input)) return counts;
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const theme = String(item.theme || "").trim();
    if (!SUMMARY_THEME_LABELS.includes(theme)) continue;
    counts[theme] += asFiniteNumber(item.count);
  }
  return counts;
}

function normalizeDebates(input) {
  const debates = createDebateRecord();
  if (!Array.isArray(input)) return debates;
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const issue = String(item.issue || "").trim();
    if (!SUMMARY_DEBATE_LABELS.includes(issue)) continue;
    debates[issue].mentions += asFiniteNumber(item.mentions);
    debates[issue].pro += asFiniteNumber(item.pro);
    debates[issue].contra += asFiniteNumber(item.contra);
  }
  return debates;
}

function addCountRecords(target, source, labels) {
  for (const label of labels) {
    target[label] += asFiniteNumber(source[label]);
  }
}

function addDebateRecords(target, source) {
  for (const label of SUMMARY_DEBATE_LABELS) {
    target[label].mentions += asFiniteNumber(source[label]?.mentions);
    target[label].pro += asFiniteNumber(source[label]?.pro);
    target[label].contra += asFiniteNumber(source[label]?.contra);
  }
}

function getSummaryBucketHours(rangeKey, since, until) {
  if (rangeKey === "24h") return 2;
  if (rangeKey === "7d") return 12;
  if (rangeKey === "30d") return 24;

  const sinceDate = new Date(String(since || ""));
  const untilDate = new Date(String(until || ""));
  if (Number.isNaN(sinceDate.getTime()) || Number.isNaN(untilDate.getTime())) return 12;

  const durationHours = Math.max((untilDate.getTime() - sinceDate.getTime()) / (60 * 60 * 1000), 1);
  if (durationHours <= 48) return 2;
  if (durationHours <= 24 * 14) return 12;
  return 24;
}

function buildMixBuckets(sourceBuckets, key) {
  return sourceBuckets.map((bucket) => ({
    bucket_start: bucket.bucket_start,
    bucket_end: bucket.bucket_end,
    post_count: bucket.post_count,
    significant_count: bucket.significant_count,
    total_count: sumRecordValues(bucket[key]),
    counts: bucket[key],
  }));
}

function buildDebateBuckets(sourceBuckets) {
  return sourceBuckets.map((bucket) => ({
    bucket_start: bucket.bucket_start,
    bucket_end: bucket.bucket_end,
    post_count: bucket.post_count,
    significant_count: bucket.significant_count,
    total_mentions: SUMMARY_DEBATE_LABELS.reduce(
      (sum, label) => sum + asFiniteNumber(bucket.debate_counts[label]?.mentions),
      0
    ),
    issues: bucket.debate_counts,
  }));
}

export function buildSummaryTrends(rows, options = {}) {
  const bucketHours = getSummaryBucketHours(options.rangeKey || null, options.since, options.until);
  const grouped = new Map();
  let coverageStartMs = null;
  let coverageEndMs = null;

  for (const row of Array.isArray(rows) ? rows : []) {
    const windowStartIso = toIsoString(row?.window_start);
    const windowEndIso = toIsoString(row?.window_end);
    if (!windowStartIso || !windowEndIso) continue;

    const bucketStartMs = alignBucketStartMs(windowStartIso, bucketHours);
    if (bucketStartMs === null) continue;

    const windowStartMs = Date.parse(windowStartIso);
    const windowEndMs = Date.parse(windowEndIso);
    coverageStartMs = coverageStartMs === null ? windowStartMs : Math.min(coverageStartMs, windowStartMs);
    coverageEndMs = coverageEndMs === null ? windowEndMs : Math.max(coverageEndMs, windowEndMs);

    let bucket = grouped.get(bucketStartMs);
    if (!bucket) {
      bucket = {
        bucket_start: new Date(bucketStartMs).toISOString(),
        bucket_end: new Date(bucketStartMs + (bucketHours * 60 * 60 * 1000)).toISOString(),
        post_count: 0,
        significant_count: 0,
        theme_counts: createCountRecord(SUMMARY_THEME_LABELS),
        tier_counts: createCountRecord(SUMMARY_TIER_LABELS),
        debate_counts: createDebateRecord(),
      };
      grouped.set(bucketStartMs, bucket);
    }

    bucket.post_count += asFiniteNumber(row?.post_count);
    bucket.significant_count += asFiniteNumber(row?.significant_count);
    addCountRecords(bucket.theme_counts, normalizeThemeCounts(row?.top_themes_json ?? row?.top_themes), SUMMARY_THEME_LABELS);
    addCountRecords(bucket.tier_counts, normalizeTierCounts(row?.tier_counts_json ?? row?.tier_counts), SUMMARY_TIER_LABELS);
    addDebateRecords(bucket.debate_counts, normalizeDebates(row?.debates_json ?? row?.debates));
  }

  const sourceBuckets = [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1]);

  return {
    scope: {
      coverage_start: coverageStartMs === null ? null : new Date(coverageStartMs).toISOString(),
      coverage_end: coverageEndMs === null ? null : new Date(coverageEndMs).toISOString(),
      source_window_type: "rolling_2h",
      source_bucket_hours: TWO_HOUR_BUCKET_HOURS,
      bucket_hours: bucketHours,
      conversation_wide: true,
    },
    theme_mix: {
      labels: [...SUMMARY_THEME_LABELS],
      buckets: buildMixBuckets(sourceBuckets, "theme_counts"),
    },
    debate_trends: {
      labels: [...SUMMARY_DEBATE_LABELS],
      buckets: buildDebateBuckets(sourceBuckets),
    },
    tier_mix: {
      labels: SUMMARY_TIER_LABELS,
      buckets: buildMixBuckets(sourceBuckets, "tier_counts"),
    },
  };
}
