import { createHash } from "node:crypto";

const WATCH_TIERS = new Set(["teammate", "influencer", "ecosystem"]);
const QUERY_REPLY_MODES = new Set(["off", "term_constrained", "selected_handles"]);

const DEFAULT_WATCHLIST_TIERS = {
  bostonzcash: "teammate",
  jwihart: "teammate",
  nuttycom: "teammate",
  paulbrigner: "teammate",
  peacemongerz: "teammate",
  tonymargarit: "teammate",
  txds_: "teammate",
  zodl_app: "teammate",
  _tomhoward: "influencer",
  anonymist: "influencer",
  aquietinvestor: "influencer",
  arjunkhemani: "influencer",
  balajis: "influencer",
  bitlarrain: "influencer",
  btcturtle: "influencer",
  cypherpunk: "influencer",
  dignitycipher: "influencer",
  dismad8: "influencer",
  ebfull: "influencer",
  ivydngg: "influencer",
  lucidzk: "influencer",
  maxdesalle: "influencer",
  mert: "influencer",
  mindsfiction: "influencer",
  minezcash: "influencer",
  nate_zec: "influencer",
  naval: "influencer",
  neuralunlock: "influencer",
  rargulati: "influencer",
  roommatemusing: "influencer",
  shieldedmoney: "influencer",
  thecodebuffet: "influencer",
  thortorrens: "influencer",
  valkenburgh: "influencer",
  zerodartz: "influencer",
  zooko: "influencer",
  zpartanll7: "influencer",
  genzcash: "ecosystem",
  shieldedlabs: "ecosystem",
  zcashcommgrants: "ecosystem",
  zcashfoundation: "ecosystem",
  zechub: "ecosystem",
};

const DEFAULT_BASE_TERMS = "Zcash OR ZEC OR Zodl OR #ZODL OR Zashi";
const DEFAULT_X_API_BASE_URL = "https://api.x.com/2";
const DEFAULT_INGEST_API_BASE_URL = "https://www.zodldashboard.com/api/v1";
const DEFAULT_EMBEDDING_BASE_URL = "https://api.venice.ai/api/v1";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-bge-m3";
const DEFAULT_EMBEDDING_DIMS = 1024;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 10000;

function asString(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function asBool(value, fallback) {
  if (typeof value === "boolean") return value;
  const text = asString(value).toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function asPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function asNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function parseHandleList(value) {
  const text = asString(value);
  if (!text) return [];
  const handles = text
    .split(/[\s,]+/)
    .map((item) => normalizeHandle(item))
    .filter((item) => item.length > 0);
  return [...new Set(handles)];
}

function parseTierSet(value) {
  const tiers = parseHandleList(value).filter((item) => WATCH_TIERS.has(item));
  if (tiers.length === 0) {
    return new Set(WATCH_TIERS);
  }
  return new Set(tiers);
}

function parseWatchlistTierMap() {
  const raw = asString(process.env.XMON_X_API_WATCHLIST_TIERS_JSON);
  if (!raw) {
    return { ...DEFAULT_WATCHLIST_TIERS };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("watchlist JSON is not an object");
    }

    const map = {};
    for (const [handle, tierRaw] of Object.entries(parsed)) {
      const normalizedHandle = normalizeHandle(handle);
      const normalizedTier = asString(tierRaw).toLowerCase();
      if (!normalizedHandle || !WATCH_TIERS.has(normalizedTier)) continue;
      map[normalizedHandle] = normalizedTier;
    }

    if (Object.keys(map).length === 0) {
      throw new Error("watchlist JSON contained no valid handle:tier entries");
    }
    return map;
  } catch (error) {
    throw new Error(`invalid XMON_X_API_WATCHLIST_TIERS_JSON: ${error instanceof Error ? error.message : "parse failed"}`);
  }
}

function buildWatchlistTierMap() {
  const tierMap = parseWatchlistTierMap();
  const include = parseHandleList(process.env.XMON_X_API_WATCHLIST_INCLUDE_HANDLES);
  if (include.length === 0) return tierMap;

  const included = {};
  for (const handle of include) {
    const tier = tierMap[handle];
    if (tier) included[handle] = tier;
  }
  return included;
}

function chunkHandles(handles, chunkSize) {
  const chunks = [];
  for (let i = 0; i < handles.length; i += chunkSize) {
    chunks.push(handles.slice(i, i + chunkSize));
  }
  return chunks;
}

function buildPriorityQuery(handles, baseTerms, options) {
  const handlesExpr = handles.map((handle) => `from:${handle}`).join(" OR ");
  const clauses = [`(${handlesExpr})`, `(${baseTerms})`];
  if (options.excludeRetweets) clauses.push("-is:retweet");
  if (options.excludeQuotes) clauses.push("-is:quote");
  return clauses.join(" ");
}

function buildReplyTermConstrainedQuery(handles, baseTerms, options) {
  const handlesExpr = handles.map((handle) => `from:${handle}`).join(" OR ");
  const clauses = [`(${handlesExpr})`, "is:reply", `(${baseTerms})`];
  if (options.excludeRetweets) clauses.push("-is:retweet");
  if (options.excludeQuotes) clauses.push("-is:quote");
  return clauses.join(" ");
}

function buildReplySelectedHandlesQuery(handles, options) {
  const handlesExpr = handles.map((handle) => `from:${handle}`).join(" OR ");
  const clauses = [`(${handlesExpr})`, "is:reply"];
  if (options.excludeRetweets) clauses.push("-is:retweet");
  if (options.excludeQuotes) clauses.push("-is:quote");
  return clauses.join(" ");
}

function buildQueryPlan(config, watchlistMap) {
  const handles = Object.keys(watchlistMap).sort();
  const handleChunks = chunkHandles(handles, config.handleChunkSize);
  const queries = [];

  for (const chunk of handleChunks) {
    queries.push({
      sourceQuery: "priority",
      query: buildPriorityQuery(chunk, config.baseTerms, config),
      handles: chunk,
      family: "priority",
    });
  }

  if (!config.replyCaptureEnabled) {
    return queries;
  }

  const replyTierSet = parseTierSet(process.env.XMON_X_API_REPLY_TIERS);
  const replyHandlesByTier = handles.filter((handle) => replyTierSet.has(watchlistMap[handle]));

  let replyMode = config.replyMode;
  let replyHandles = replyHandlesByTier;
  if (replyMode === "selected_handles") {
    const selected = new Set(parseHandleList(process.env.XMON_X_API_REPLY_SELECTED_HANDLES));
    replyHandles = replyHandlesByTier.filter((handle) => selected.has(handle));
    if (replyHandles.length === 0) {
      replyMode = "off";
    }
  }

  if (replyMode === "off") {
    return queries;
  }

  const replyChunks = chunkHandles(replyHandles, config.handleChunkSize);
  for (const chunk of replyChunks) {
    if (chunk.length === 0) continue;
    if (replyMode === "selected_handles") {
      queries.push({
        sourceQuery: "priority_reply_selected",
        query: buildReplySelectedHandlesQuery(chunk, config),
        handles: chunk,
        family: "priority_reply_selected",
      });
      continue;
    }

    queries.push({
      sourceQuery: "priority_reply_term",
      query: buildReplyTermConstrainedQuery(chunk, config.baseTerms, config),
      handles: chunk,
      family: "priority_reply_term",
    });
  }

  return queries;
}

function getConfig() {
  const replyMode = asString(process.env.XMON_X_API_REPLY_MODE || "term_constrained").toLowerCase();
  const normalizedReplyMode = QUERY_REPLY_MODES.has(replyMode) ? replyMode : "term_constrained";

  return {
    collectorEnabled: asBool(process.env.XMON_COLLECTOR_ENABLED, true),
    writeEnabled: asBool(process.env.XMON_COLLECTOR_WRITE_ENABLED, true),
    collectorSource: asString(process.env.XMON_COLLECTOR_SOURCE) || "aws-lambda-x-api",
    xApiBearerToken: asString(process.env.XMON_X_API_BEARER_TOKEN),
    xApiBaseUrl: (asString(process.env.XMON_X_API_BASE_URL) || DEFAULT_X_API_BASE_URL).replace(/\/+$/, ""),
    ingestApiBaseUrl: (asString(process.env.XMONITOR_API_BASE_URL) || DEFAULT_INGEST_API_BASE_URL).replace(/\/+$/, ""),
    ingestApiKey: asString(process.env.XMONITOR_API_KEY),
    baseTerms: asString(process.env.XMON_X_API_BASE_TERMS) || DEFAULT_BASE_TERMS,
    maxResultsPerPage: asPositiveInt(process.env.XMON_X_API_MAX_RESULTS_PER_QUERY, 100),
    maxPagesPerQuery: asPositiveInt(process.env.XMON_X_API_MAX_PAGES_PER_QUERY, 2),
    queryTimeoutMs: asPositiveInt(process.env.XMON_X_API_QUERY_TIMEOUT_MS, 15000),
    ingestTimeoutMs: asPositiveInt(process.env.XMON_INGEST_TIMEOUT_MS, 20000),
    handleChunkSize: asPositiveInt(process.env.XMON_X_API_HANDLE_CHUNK_SIZE, 16),
    replyCaptureEnabled: asBool(process.env.XMON_X_API_REPLY_CAPTURE_ENABLED, true),
    replyMode: normalizedReplyMode,
    excludeRetweets: asBool(process.env.XMON_X_API_EXCLUDE_RETWEETS, true),
    excludeQuotes: asBool(process.env.XMON_X_API_EXCLUDE_QUOTES, false),
    enforceLangAllowlist: asBool(process.env.XMON_X_API_ENFORCE_LANG_ALLOWLIST, true),
    langAllowlist: new Set(parseHandleList(process.env.XMON_X_API_LANG_ALLOWLIST || "en")),
    ingestBatchSize: asPositiveInt(process.env.XMON_INGEST_BATCH_SIZE, 200),
    requestPauseMs: asPositiveInt(process.env.XMON_X_API_REQUEST_PAUSE_MS, 200),
    embeddingEnabled: asBool(process.env.XMON_EMBEDDING_ENABLED, true),
    embeddingBaseUrl: (asString(process.env.XMONITOR_EMBEDDING_BASE_URL) || DEFAULT_EMBEDDING_BASE_URL).replace(/\/+$/, ""),
    embeddingModel: asString(process.env.XMONITOR_EMBEDDING_MODEL) || DEFAULT_EMBEDDING_MODEL,
    embeddingDims: asPositiveInt(process.env.XMONITOR_EMBEDDING_DIMS, DEFAULT_EMBEDDING_DIMS),
    embeddingTimeoutMs: asPositiveInt(process.env.XMONITOR_EMBEDDING_TIMEOUT_MS, DEFAULT_EMBEDDING_TIMEOUT_MS),
    embeddingApiKey: asString(process.env.XMONITOR_EMBEDDING_API_KEY) || asString(process.env.VENICE_API_KEY),
    embeddingBatchSize: asPositiveInt(process.env.XMON_EMBEDDING_BATCH_SIZE, 16),
    embeddingMaxItemsPerRun: asNonNegativeInt(process.env.XMON_EMBEDDING_MAX_ITEMS_PER_RUN, 0),
    embeddingIncludeUpdated: asBool(process.env.XMON_EMBEDDING_INCLUDE_UPDATED, false),
    embeddingFallbackAllIfNoIds: asBool(process.env.XMON_EMBEDDING_FALLBACK_ALL_IF_NO_IDS, false),
  };
}

function requireConfig(config) {
  const missing = [];
  if (!config.xApiBearerToken) missing.push("XMON_X_API_BEARER_TOKEN");
  if (!config.ingestApiKey && config.writeEnabled) missing.push("XMONITOR_API_KEY");
  if (!config.ingestApiBaseUrl && config.writeEnabled) missing.push("XMONITOR_API_BASE_URL");
  if (config.embeddingEnabled && config.writeEnabled) {
    if (!config.embeddingApiKey) missing.push("XMONITOR_EMBEDDING_API_KEY");
    if (!config.embeddingModel) missing.push("XMONITOR_EMBEDDING_MODEL");
  }
  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(", ")}`);
  }
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function coerceInt(value) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasRetweetReference(tweet) {
  if (!Array.isArray(tweet?.referenced_tweets)) return false;
  return tweet.referenced_tweets.some((item) => asString(item?.type).toLowerCase() === "retweeted");
}

function cleanupText(text) {
  const normalized = String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function hasSubstance(text, isReply) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return false;
  const words = cleaned.match(/[A-Za-z0-9']+/g) || [];
  const meaningful = words.filter((word) => word.length >= 2 && !/^\d+$/.test(word));
  if (isReply) {
    return meaningful.length >= 8 || cleaned.length >= 55;
  }
  return meaningful.length >= 6 || cleaned.length >= 40;
}

function evaluateSignificance(post, watchTier) {
  const likes = coerceInt(post?.public_metrics?.like_count);
  const reposts = coerceInt(post?.public_metrics?.retweet_count);
  const isReply = Array.isArray(post?.referenced_tweets)
    && post.referenced_tweets.some((item) => asString(item?.type).toLowerCase() === "replied_to");

  const text = cleanupText(post?.text) || "";
  const substanceOk = hasSubstance(text, isReply);
  const engagementModerate = likes >= 25 || reposts >= 10;
  const engagementStrong = reposts >= 8 || (reposts >= 3 && likes >= 100);

  if (!watchTier) {
    if (engagementStrong && (substanceOk || text.length >= 20)) {
      return { isSignificant: true, reason: `engagement:${likes} likes/${reposts} reposts` };
    }
    return { isSignificant: false, reason: "low_signal" };
  }

  if (substanceOk || engagementModerate || engagementStrong) {
    if (engagementModerate) {
      return { isSignificant: true, reason: `watchlist:${watchTier};engagement:${likes}/${reposts}` };
    }
    return { isSignificant: true, reason: `watchlist:${watchTier}` };
  }

  return { isSignificant: false, reason: "low_substance_watchlist" };
}

function comparePriority(existing, incoming) {
  const sourceRank = (sourceQuery) => {
    if (sourceQuery === "priority") return 3;
    if (sourceQuery === "priority_reply_selected") return 2;
    if (sourceQuery === "priority_reply_term") return 1;
    return 0;
  };

  const existingRank = sourceRank(existing.source_query);
  const incomingRank = sourceRank(incoming.source_query);
  if (incomingRank !== existingRank) return incomingRank - existingRank;

  const existingEngagement = coerceInt(existing.likes) + coerceInt(existing.reposts) + coerceInt(existing.replies) + coerceInt(existing.views);
  const incomingEngagement = coerceInt(incoming.likes) + coerceInt(incoming.reposts) + coerceInt(incoming.replies) + coerceInt(incoming.views);
  return incomingEngagement - existingEngagement;
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      throw new Error(`request failed (${response.status}): ${text.slice(0, 400)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function buildSearchUrl(config, query, nextToken) {
  const url = new URL(`${config.xApiBaseUrl}/tweets/search/recent`);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(config.maxResultsPerPage));
  url.searchParams.set("tweet.fields", "author_id,created_at,lang,public_metrics,referenced_tweets");
  url.searchParams.set("user.fields", "id,name,username");
  url.searchParams.set("expansions", "author_id");
  if (nextToken) {
    url.searchParams.set("next_token", nextToken);
  }
  return url.toString();
}

function getUserMap(payload) {
  const map = new Map();
  const users = payload?.includes?.users;
  if (!Array.isArray(users)) return map;
  for (const user of users) {
    const id = asString(user?.id);
    if (!id) continue;
    map.set(id, user);
  }
  return map;
}

function toIso(value, fallbackIso) {
  const text = asString(value);
  if (!text) return fallbackIso;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return fallbackIso;
  return parsed.toISOString();
}

function buildPostRecord(tweet, user, sourceQuery, watchTier, seenAtIso) {
  const authorHandle = normalizeHandle(user?.username);
  const authorDisplay = asString(user?.name) || null;
  const metrics = tweet?.public_metrics || {};
  const significance = evaluateSignificance(tweet, watchTier);

  return {
    status_id: String(tweet.id),
    url: `https://x.com/${authorHandle}/status/${tweet.id}`,
    author_handle: authorHandle,
    author_display: authorDisplay,
    body_text: cleanupText(tweet.text),
    posted_relative: null,
    source_query: sourceQuery,
    watch_tier: watchTier,
    is_significant: significance.isSignificant,
    significance_reason: significance.reason,
    likes: coerceInt(metrics.like_count),
    reposts: coerceInt(metrics.retweet_count),
    replies: coerceInt(metrics.reply_count),
    views: coerceInt(metrics.impression_count),
    discovered_at: toIso(tweet.created_at, seenAtIso),
    last_seen_at: seenAtIso,
  };
}

function shouldKeepTweet(tweet, user, watchlistMap, config, counters) {
  if (!tweet?.id || !tweet?.author_id || !user) {
    counters.skippedMalformed += 1;
    return false;
  }

  if (config.excludeRetweets && hasRetweetReference(tweet)) {
    counters.skippedRetweet += 1;
    return false;
  }

  const authorHandle = normalizeHandle(user?.username);
  if (!authorHandle) {
    counters.skippedMalformed += 1;
    return false;
  }

  if (!watchlistMap[authorHandle]) {
    counters.skippedNonWatchlist += 1;
    return false;
  }

  if (config.enforceLangAllowlist) {
    const lang = asString(tweet?.lang).toLowerCase();
    if (!lang || !config.langAllowlist.has(lang)) {
      counters.skippedLang += 1;
      return false;
    }
  }

  return true;
}

async function runSearchPlan(config, watchlistMap, queryPlan) {
  const seenAtIso = nowIso();
  const aggregated = new Map();

  const counters = {
    queryCount: queryPlan.length,
    pageCount: 0,
    rawTweets: 0,
    uniqueTweets: 0,
    skippedMalformed: 0,
    skippedRetweet: 0,
    skippedNonWatchlist: 0,
    skippedLang: 0,
    familyCounts: {},
    sourceCounts: {},
  };

  for (const entry of queryPlan) {
    let nextToken = null;
    let page = 0;

    do {
      const url = buildSearchUrl(config, entry.query, nextToken);
      const payload = await fetchJsonWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${config.xApiBearerToken}`,
            "content-type": "application/json",
            "user-agent": "xmonitor-xapi-collector/1.0",
          },
        },
        config.queryTimeoutMs
      );

      counters.pageCount += 1;
      page += 1;

      const userMap = getUserMap(payload);
      const tweets = Array.isArray(payload?.data) ? payload.data : [];
      counters.rawTweets += tweets.length;

      for (const tweet of tweets) {
        const user = userMap.get(String(tweet.author_id));
        if (!shouldKeepTweet(tweet, user, watchlistMap, config, counters)) continue;

        const authorHandle = normalizeHandle(user.username);
        const watchTier = watchlistMap[authorHandle] || null;
        const record = buildPostRecord(tweet, user, entry.sourceQuery, watchTier, seenAtIso);

        const existing = aggregated.get(record.status_id);
        if (!existing || comparePriority(existing, record) < 0) {
          aggregated.set(record.status_id, existing
            ? {
                ...record,
                discovered_at: existing.discovered_at < record.discovered_at ? existing.discovered_at : record.discovered_at,
              }
            : record);
        } else {
          existing.last_seen_at = seenAtIso;
        }

        counters.familyCounts[entry.family] = (counters.familyCounts[entry.family] || 0) + 1;
        counters.sourceCounts[entry.sourceQuery] = (counters.sourceCounts[entry.sourceQuery] || 0) + 1;
      }

      nextToken = asString(payload?.meta?.next_token) || "";
      if (page >= config.maxPagesPerQuery || !nextToken) {
        nextToken = "";
      } else {
        await sleep(config.requestPauseMs);
      }
    } while (nextToken);
  }

  counters.uniqueTweets = aggregated.size;
  return {
    seenAtIso,
    posts: Array.from(aggregated.values()),
    counters,
  };
}

async function postJsonWithTimeout(url, apiKey, payload, timeoutMs) {
  return fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );
}

async function ingestPosts(config, posts) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  const insertedStatusIds = new Set();
  const updatedStatusIds = new Set();

  for (let i = 0; i < posts.length; i += config.ingestBatchSize) {
    const items = posts.slice(i, i + config.ingestBatchSize);
    const response = await postJsonWithTimeout(
      `${config.ingestApiBaseUrl}/ingest/posts/batch`,
      config.ingestApiKey,
      { items },
      config.ingestTimeoutMs
    );

    inserted += coerceInt(response?.inserted);
    updated += coerceInt(response?.updated);
    skipped += coerceInt(response?.skipped);
    if (Array.isArray(response?.errors) && response.errors.length > 0) {
      errors.push(...response.errors);
    }
    if (Array.isArray(response?.inserted_status_ids)) {
      for (const statusId of response.inserted_status_ids) {
        const normalized = asString(statusId);
        if (normalized) insertedStatusIds.add(normalized);
      }
    }
    if (Array.isArray(response?.updated_status_ids)) {
      for (const statusId of response.updated_status_ids) {
        const normalized = asString(statusId);
        if (normalized) updatedStatusIds.add(normalized);
      }
    }
  }

  return {
    inserted,
    updated,
    skipped,
    errors,
    inserted_status_ids: [...insertedStatusIds],
    updated_status_ids: [...updatedStatusIds],
  };
}

function buildEmbeddingSource(post) {
  const handle = normalizeHandle(post?.author_handle);
  const body = asString(post?.body_text);
  const source = `@${handle} ${body || ""}`.trim();
  return source || "";
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function requestEmbeddingVectors(config, texts) {
  const endpoint = `${config.embeddingBaseUrl}/embeddings`;
  const payload = {
    model: config.embeddingModel,
    input: texts,
    encoding_format: "float",
  };

  const response = await fetchJsonWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.embeddingApiKey}`,
        "content-type": "application/json",
        "user-agent": "xmonitor-xapi-collector/1.0",
      },
      body: JSON.stringify(payload),
    },
    config.embeddingTimeoutMs
  );

  const data = Array.isArray(response?.data) ? response.data : [];
  if (data.length !== texts.length) {
    throw new Error(`embedding response length mismatch: expected ${texts.length}, got ${data.length}`);
  }

  return data.map((item, index) => {
    const vector = item?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error(`embedding response missing vector at index ${index}`);
    }
    const parsed = vector.map((value) => Number(value));
    if (parsed.some((value) => !Number.isFinite(value))) {
      throw new Error(`embedding vector contains non-numeric values at index ${index}`);
    }
    if (parsed.length !== config.embeddingDims) {
      throw new Error(`embedding dims mismatch at index ${index}: expected ${config.embeddingDims}, got ${parsed.length}`);
    }
    return parsed;
  });
}

async function requestEmbeddingVectorsWithRetry(config, texts) {
  const maxAttempts = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestEmbeddingVectors(config, texts);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await sleep(400 * (2 ** (attempt - 1)));
    }
  }
  throw lastError || new Error("embedding request failed");
}

function selectEmbeddingCandidates(config, posts, ingestResult) {
  const byId = new Map(posts.map((post) => [String(post.status_id), post]));
  const selectedIds = new Set(ingestResult?.inserted_status_ids || []);

  if (config.embeddingIncludeUpdated && Array.isArray(ingestResult?.updated_status_ids)) {
    for (const statusId of ingestResult.updated_status_ids) {
      selectedIds.add(statusId);
    }
  }

  if (selectedIds.size === 0 && config.embeddingFallbackAllIfNoIds) {
    for (const post of posts) {
      selectedIds.add(String(post.status_id));
    }
  }

  const candidates = [];
  for (const statusId of selectedIds) {
    const post = byId.get(String(statusId));
    if (!post) continue;
    const sourceText = buildEmbeddingSource(post);
    if (!sourceText) continue;
    candidates.push({
      status_id: String(post.status_id),
      source_text: sourceText,
    });
  }

  if (config.embeddingMaxItemsPerRun > 0 && candidates.length > config.embeddingMaxItemsPerRun) {
    return {
      candidates: candidates.slice(0, config.embeddingMaxItemsPerRun),
      capped_count: candidates.length - config.embeddingMaxItemsPerRun,
    };
  }

  return { candidates, capped_count: 0 };
}

async function buildEmbeddingItems(config, candidates, timestampIso) {
  const items = [];
  const failures = [];
  const batches = chunkArray(candidates, config.embeddingBatchSize);

  for (const batch of batches) {
    const texts = batch.map((item) => item.source_text);
    let vectors;
    try {
      vectors = await requestEmbeddingVectorsWithRetry(config, texts);
    } catch (error) {
      failures.push({
        batch_size: batch.length,
        message: error instanceof Error ? error.message : "embedding request failed",
      });
      continue;
    }

    for (let i = 0; i < batch.length; i += 1) {
      const candidate = batch[i];
      const vector = vectors[i];
      items.push({
        status_id: candidate.status_id,
        backend: "openai",
        model: config.embeddingModel,
        dims: vector.length,
        vector,
        text_hash: sha256Hex(candidate.source_text),
        created_at: timestampIso,
        updated_at: timestampIso,
      });
    }
  }

  return { items, failures };
}

async function ingestEmbeddings(config, items) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < items.length; i += config.ingestBatchSize) {
    const batchItems = items.slice(i, i + config.ingestBatchSize);
    const response = await postJsonWithTimeout(
      `${config.ingestApiBaseUrl}/ingest/embeddings/batch`,
      config.ingestApiKey,
      { items: batchItems },
      config.ingestTimeoutMs
    );

    inserted += coerceInt(response?.inserted);
    updated += coerceInt(response?.updated);
    skipped += coerceInt(response?.skipped);
    if (Array.isArray(response?.errors) && response.errors.length > 0) {
      errors.push(...response.errors);
    }
  }

  return { inserted, updated, skipped, errors };
}

function buildRunNote(config, counters, posts) {
  const significantCount = posts.filter((item) => item.is_significant).length;
  const parts = [
    "source=lambda_x_api",
    `queries=${counters.queryCount}`,
    `pages=${counters.pageCount}`,
    `raw=${counters.rawTweets}`,
    `unique=${counters.uniqueTweets}`,
    `significant=${significantCount}`,
    `reply_enabled=${config.replyCaptureEnabled ? 1 : 0}`,
    `reply_mode=${config.replyCaptureEnabled ? config.replyMode : "off"}`,
    `skipped_lang=${counters.skippedLang}`,
    `skipped_non_watchlist=${counters.skippedNonWatchlist}`,
    `skipped_retweet=${counters.skippedRetweet}`,
    `skipped_malformed=${counters.skippedMalformed}`,
  ];

  const familySummary = Object.entries(counters.familyCounts)
    .map(([key, count]) => `${key}:${count}`)
    .join(",");
  if (familySummary) {
    parts.push(`query_families=${familySummary}`);
  }

  return parts.join(";");
}

async function ingestRun(config, counters, posts, dryRun) {
  const significantCount = posts.filter((item) => item.is_significant).length;
  const runPayload = {
    run_at: nowIso(),
    mode: "priority",
    fetched_count: counters.uniqueTweets,
    significant_count: significantCount,
    reported_count: 0,
    note: buildRunNote(config, counters, posts),
    source: config.collectorSource,
  };

  if (dryRun || !config.writeEnabled) {
    return { skipped: true, payload: runPayload };
  }

  const response = await postJsonWithTimeout(
    `${config.ingestApiBaseUrl}/ingest/runs`,
    config.ingestApiKey,
    runPayload,
    config.ingestTimeoutMs
  );
  return { skipped: false, response, payload: runPayload };
}

function summarizeResult(config, queryPlan, counters, posts, ingestResult, embeddingResult, runResult, dryRun) {
  return {
    ok: true,
    collector_enabled: config.collectorEnabled,
    write_enabled: config.writeEnabled,
    dry_run: dryRun,
    query_count: queryPlan.length,
    query_families: [...new Set(queryPlan.map((item) => item.family))],
    counters,
    post_summary: {
      total: posts.length,
      significant: posts.filter((item) => item.is_significant).length,
      by_tier: posts.reduce((acc, item) => {
        const tier = asString(item.watch_tier) || "other";
        acc[tier] = (acc[tier] || 0) + 1;
        return acc;
      }, {}),
    },
    ingest: ingestResult,
    embeddings: embeddingResult,
    run: runResult,
  };
}

export async function handler(event = {}) {
  const config = getConfig();
  const dryRun = asBool(event?.dryRun ?? process.env.XMON_COLLECTOR_DRY_RUN, false);

  if (!config.collectorEnabled) {
    const skipped = {
      ok: true,
      skipped: true,
      reason: "collector_disabled",
      collector_enabled: false,
    };
    console.log(JSON.stringify(skipped));
    return skipped;
  }

  requireConfig(config);

  const watchlistMap = buildWatchlistTierMap();
  if (Object.keys(watchlistMap).length === 0) {
    throw new Error("watchlist is empty after applying include filters");
  }

  const queryPlan = buildQueryPlan(config, watchlistMap);
  if (queryPlan.length === 0) {
    throw new Error("query plan is empty");
  }

  const { posts, counters } = await runSearchPlan(config, watchlistMap, queryPlan);

  let ingestResult = {
    skipped: true,
    reason: dryRun ? "dry_run" : "writes_disabled",
    inserted: 0,
    updated: 0,
    skipped_items: 0,
    errors: [],
    inserted_status_ids: [],
    updated_status_ids: [],
  };

  let embeddingResult = {
    skipped: true,
    reason: dryRun ? "dry_run" : "writes_disabled",
    selected_candidates: 0,
    embedded_candidates: 0,
    capped_candidates: 0,
    request_failures: [],
    inserted: 0,
    updated: 0,
    skipped_items: 0,
    errors: [],
  };

  if (!dryRun && config.writeEnabled) {
    const ingested = await ingestPosts(config, posts);
    ingestResult = {
      skipped: false,
      inserted: ingested.inserted,
      updated: ingested.updated,
      skipped_items: ingested.skipped,
      errors: ingested.errors,
      inserted_status_ids: ingested.inserted_status_ids,
      updated_status_ids: ingested.updated_status_ids,
    };
  }

  if (config.embeddingEnabled) {
    const selected = selectEmbeddingCandidates(config, posts, ingestResult);
    if (selected.candidates.length === 0) {
      embeddingResult = {
        skipped: true,
        reason: selected.capped_count > 0 ? "no_candidates_after_cap" : "no_candidates",
        selected_candidates: 0,
        embedded_candidates: 0,
        capped_candidates: selected.capped_count,
        request_failures: [],
        inserted: 0,
        updated: 0,
        skipped_items: 0,
        errors: [],
      };
    } else {
      const built = await buildEmbeddingItems(config, selected.candidates, nowIso());
      if (built.items.length === 0) {
        embeddingResult = {
          skipped: true,
          reason: "embedding_requests_failed",
          selected_candidates: selected.candidates.length,
          embedded_candidates: 0,
          capped_candidates: selected.capped_count,
          request_failures: built.failures,
          inserted: 0,
          updated: 0,
          skipped_items: 0,
          errors: [],
        };
      } else if (dryRun || !config.writeEnabled) {
        embeddingResult = {
          skipped: true,
          reason: dryRun ? "dry_run" : "writes_disabled",
          selected_candidates: selected.candidates.length,
          embedded_candidates: built.items.length,
          capped_candidates: selected.capped_count,
          request_failures: built.failures,
          inserted: 0,
          updated: 0,
          skipped_items: 0,
          errors: [],
        };
      } else {
        const embeddingIngest = await ingestEmbeddings(config, built.items);
        embeddingResult = {
          skipped: false,
          reason: null,
          selected_candidates: selected.candidates.length,
          embedded_candidates: built.items.length,
          capped_candidates: selected.capped_count,
          request_failures: built.failures,
          inserted: embeddingIngest.inserted,
          updated: embeddingIngest.updated,
          skipped_items: embeddingIngest.skipped,
          errors: embeddingIngest.errors,
        };
      }
    }
  } else {
    embeddingResult = {
      skipped: true,
      reason: "embedding_disabled",
      selected_candidates: 0,
      embedded_candidates: 0,
      capped_candidates: 0,
      request_failures: [],
      inserted: 0,
      updated: 0,
      skipped_items: 0,
      errors: [],
    };
  }

  const runResult = await ingestRun(config, counters, posts, dryRun);
  const summary = summarizeResult(config, queryPlan, counters, posts, ingestResult, embeddingResult, runResult, dryRun);
  console.log(JSON.stringify(summary));
  return summary;
}
