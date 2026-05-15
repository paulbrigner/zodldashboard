#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  DEFAULT_WATCHLIST_TIERS,
  TWEET_FIELDS,
  buildPostRecord,
  isArticleTweet,
} from "../../services/x-api-collector-lambda/index.mjs";

const DEFAULT_API_BASE_URL = "https://www.zodldashboard.com/api/v1";
const DEFAULT_X_API_BASE_URL = "https://api.x.com/2";
const DEFAULT_SECRET_ID = "xmonitor/rds/app";
const DEFAULT_AWS_PROFILE = "zodldashboard";
const DEFAULT_AWS_REGION = "us-east-1";

function usage() {
  return [
    "Usage: node scripts/ops/backfill_x_articles.mjs --start 2026-02-14T00:00:00Z [options]",
    "",
    "Options:",
    "  --start <iso>          Earliest post time to scan. Defaults to --days ago.",
    "  --end <iso>            Latest post time to scan. Defaults to now.",
    "  --days <n>             Lookback window if --start is omitted. Default: 90.",
    "  --handles <list>       Comma/space separated watchlist handles. Default: all collector watchlist handles.",
    "  --dry-run              Scan and summarize without ingesting.",
    "  --batch-size <n>       Ingest batch size. Default: 100.",
    "  --pause-ms <n>         Pause between X API page requests. Default: 200.",
    "  --aws-profile <name>   AWS profile for fallback secret lookup. Default: zodldashboard.",
    "  --aws-region <region>  AWS region for fallback secret lookup. Default: us-east-1.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    days: 90,
    batchSize: 100,
    pauseMs: 200,
    awsProfile: process.env.AWS_PROFILE || DEFAULT_AWS_PROFILE,
    awsRegion: process.env.AWS_REGION || DEFAULT_AWS_REGION,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    const needsValue = new Set([
      "--start",
      "--end",
      "--days",
      "--handles",
      "--batch-size",
      "--pause-ms",
      "--aws-profile",
      "--aws-region",
    ]);
    if (!needsValue.has(arg)) {
      throw new Error(`unknown argument: ${arg}`);
    }
    const value = argv[i + 1];
    if (!value) throw new Error(`missing value for ${arg}`);
    i += 1;
    if (arg === "--start") args.start = value;
    if (arg === "--end") args.end = value;
    if (arg === "--days") args.days = Number.parseInt(value, 10);
    if (arg === "--handles") args.handles = value;
    if (arg === "--batch-size") args.batchSize = Number.parseInt(value, 10);
    if (arg === "--pause-ms") args.pauseMs = Number.parseInt(value, 10);
    if (arg === "--aws-profile") args.awsProfile = value;
    if (arg === "--aws-region") args.awsRegion = value;
  }

  if (!Number.isFinite(args.days) || args.days <= 0) throw new Error("--days must be positive");
  if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) throw new Error("--batch-size must be positive");
  if (!Number.isFinite(args.pauseMs) || args.pauseMs < 0) throw new Error("--pause-ms must be non-negative");
  return args;
}

function normalizeHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function parseHandles(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => normalizeHandle(item))
    .filter(Boolean);
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ISO timestamp: ${value}`);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readSecretJson(args) {
  const secretId = process.env.XMONITOR_SECRET_ID || DEFAULT_SECRET_ID;
  const output = execFileSync("aws", [
    "--profile",
    args.awsProfile,
    "--region",
    args.awsRegion,
    "secretsmanager",
    "get-secret-value",
    "--secret-id",
    secretId,
    "--query",
    "SecretString",
    "--output",
    "text",
  ], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : {};
}

function loadCredentials(args) {
  let secret = {};
  const hasXToken = process.env.XMON_X_API_BEARER_TOKEN || process.env.X_API_BEARER_TOKEN;
  const hasIngestKey = process.env.XMONITOR_API_KEY || process.env.INGEST_API_KEY;
  if (!hasXToken || !hasIngestKey) {
    secret = readSecretJson(args);
  }

  const xApiBearerToken = process.env.XMON_X_API_BEARER_TOKEN
    || process.env.X_API_BEARER_TOKEN
    || secret.x_api_bearer_token
    || secret.x_bearer_token;
  const ingestApiKey = process.env.XMONITOR_API_KEY
    || process.env.INGEST_API_KEY
    || secret.ingest_shared_secret
    || secret.api_key;
  const ingestApiBaseUrl = (process.env.XMONITOR_API_BASE_URL || process.env.INGEST_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  const xApiBaseUrl = (process.env.XMON_X_API_BASE_URL || process.env.X_API_BASE_URL || DEFAULT_X_API_BASE_URL).replace(/\/+$/, "");

  if (!xApiBearerToken) throw new Error("missing X API bearer token");
  if (!ingestApiKey) throw new Error("missing X Monitor ingest API key");
  return { xApiBearerToken, ingestApiKey, ingestApiBaseUrl, xApiBaseUrl };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    const detail = payload?.detail || payload?.title || payload?.raw || response.statusText;
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  return payload;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function resolveUsers(handles, credentials) {
  const byHandle = new Map();
  for (const batch of chunk(handles, 100)) {
    const url = new URL(`${credentials.xApiBaseUrl}/users/by`);
    url.searchParams.set("usernames", batch.join(","));
    url.searchParams.set("user.fields", "id,name,username,public_metrics,created_at,location");
    const payload = await fetchJson(url, {
      headers: {
        authorization: `Bearer ${credentials.xApiBearerToken}`,
        "user-agent": "xmonitor-article-backfill/1.0",
      },
    });
    for (const user of Array.isArray(payload?.data) ? payload.data : []) {
      byHandle.set(normalizeHandle(user.username), user);
    }
  }
  return byHandle;
}

async function collectArticleRecords({ handles, watchlistMap, usersByHandle, credentials, startIso, endIso, pauseMs }) {
  const recordsById = new Map();
  const byHandle = {};
  const errors = [];

  for (const handle of handles) {
    const user = usersByHandle.get(handle);
    if (!user?.id) {
      errors.push({ handle, message: "user not resolved" });
      continue;
    }

    let nextToken = "";
    let page = 0;
    do {
      const url = new URL(`${credentials.xApiBaseUrl}/users/${user.id}/tweets`);
      url.searchParams.set("max_results", "100");
      url.searchParams.set("start_time", startIso);
      url.searchParams.set("end_time", endIso);
      url.searchParams.set("exclude", "retweets");
      url.searchParams.set("tweet.fields", TWEET_FIELDS);
      url.searchParams.set("user.fields", "id,name,username,public_metrics,created_at,location");
      url.searchParams.set("expansions", "author_id");
      if (nextToken) url.searchParams.set("pagination_token", nextToken);

      const payload = await fetchJson(url, {
        headers: {
          authorization: `Bearer ${credentials.xApiBearerToken}`,
          "user-agent": "xmonitor-article-backfill/1.0",
        },
      });
      page += 1;

      const includedUsers = new Map();
      for (const includedUser of Array.isArray(payload?.includes?.users) ? payload.includes.users : []) {
        includedUsers.set(String(includedUser.id), includedUser);
      }

      for (const tweet of Array.isArray(payload?.data) ? payload.data : []) {
        if (!isArticleTweet(tweet)) continue;
        const author = includedUsers.get(String(tweet.author_id)) || user;
        const authorHandle = normalizeHandle(author.username);
        const record = buildPostRecord(
          tweet,
          author,
          "priority_article",
          watchlistMap[authorHandle] || null,
          new Date().toISOString()
        );
        if (!recordsById.has(record.status_id)) {
          recordsById.set(record.status_id, record);
          const summary = byHandle[authorHandle] || { handle: authorHandle, articles: 0, views: 0 };
          summary.articles += 1;
          summary.views += Number(record.views || 0);
          byHandle[authorHandle] = summary;
        }
      }

      nextToken = payload?.meta?.next_token || "";
      if (nextToken) await sleep(pauseMs);
    } while (nextToken);

    if (page > 0) await sleep(pauseMs);
  }

  return {
    records: Array.from(recordsById.values()).sort((a, b) => String(a.discovered_at).localeCompare(String(b.discovered_at))),
    byHandle,
    errors,
  };
}

async function ingestRecords(records, credentials, batchSize) {
  const result = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    inserted_status_ids: [],
    updated_status_ids: [],
  };

  for (const batch of chunk(records, batchSize)) {
    const payload = await fetchJson(`${credentials.ingestApiBaseUrl}/ingest/posts/batch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": credentials.ingestApiKey,
        "user-agent": "xmonitor-article-backfill/1.0",
      },
      body: JSON.stringify({ items: batch }),
    });
    result.inserted += Number(payload?.inserted || 0);
    result.updated += Number(payload?.updated || 0);
    result.skipped += Number(payload?.skipped || 0);
    if (Array.isArray(payload?.errors)) result.errors.push(...payload.errors);
    if (Array.isArray(payload?.inserted_status_ids)) result.inserted_status_ids.push(...payload.inserted_status_ids);
    if (Array.isArray(payload?.updated_status_ids)) result.updated_status_ids.push(...payload.updated_status_ids);
  }
  return result;
}

function printSummary(summary) {
  console.log(JSON.stringify(summary, null, 2));
}

function articleTitleFromBodyText(bodyText) {
  return String(bodyText || "")
    .replace(/^X Article:\s*/i, "")
    .replace(/\s+https:\/\/x\.com\/i\/article\/\S+$/i, "")
    .slice(0, 160);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const credentials = loadCredentials(args);
  const now = new Date();
  const endIso = toIso(args.end || now);
  const startIso = toIso(args.start || new Date(now.getTime() - args.days * 24 * 60 * 60 * 1000));
  const watchlistMap = { ...DEFAULT_WATCHLIST_TIERS };
  const handles = (args.handles ? parseHandles(args.handles) : Object.keys(watchlistMap)).filter((handle) => watchlistMap[handle]);

  const usersByHandle = await resolveUsers(handles, credentials);
  const collected = await collectArticleRecords({
    handles,
    watchlistMap,
    usersByHandle,
    credentials,
    startIso,
    endIso,
    pauseMs: args.pauseMs,
  });

  const summary = {
    dry_run: args.dryRun,
    start_time: startIso,
    end_time: endIso,
    watchlist_handles: handles.length,
    resolved_users: usersByHandle.size,
    article_posts: collected.records.length,
    total_views: collected.records.reduce((sum, item) => sum + Number(item.views || 0), 0),
    by_handle: Object.fromEntries(
      Object.entries(collected.byHandle)
        .sort((a, b) => b[1].articles - a[1].articles || a[0].localeCompare(b[0]))
    ),
    sample_articles: collected.records.slice(0, 20).map((item) => ({
      status_id: item.status_id,
      author_handle: item.author_handle,
      created_at: item.discovered_at,
      title: articleTitleFromBodyText(item.body_text),
      views: item.views,
    })),
    resolve_or_scan_errors: collected.errors,
  };

  if (!args.dryRun && collected.records.length > 0) {
    summary.ingest = await ingestRecords(collected.records, credentials, args.batchSize);
  }

  printSummary(summary);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
