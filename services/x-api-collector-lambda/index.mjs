import { createHash } from "node:crypto";

const WATCH_TIERS = new Set(["teammate", "influencer", "ecosystem"]);
const QUERY_REPLY_MODES = new Set(["off", "term_constrained", "selected_handles"]);
const COLLECTOR_MODES = new Set(["priority", "discovery"]);

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

const DEFAULT_BASE_TERMS = "Zcash OR ZEC OR Zodl OR Zashi";
const DEFAULT_X_API_BASE_URL = "https://api.x.com/2";
const DEFAULT_INGEST_API_BASE_URL = "https://www.zodldashboard.com/api/v1";
const DEFAULT_EMBEDDING_BASE_URL = "https://api.venice.ai/api/v1";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-bge-m3";
const DEFAULT_EMBEDDING_DIMS = 1024;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 10000;
const DEFAULT_SUMMARY_LLM_URL = "https://api.venice.ai/api/v1";
const DEFAULT_SUMMARY_LLM_MODEL = "zai-org-glm-5";

const MATERIAL_KEYWORDS = [
  "listing",
  "delist",
  "partnership",
  "exploit",
  "vulnerability",
  "upgrade",
  "hard fork",
  "release",
  "regulation",
  "etf",
  "integration",
  "wallet support",
  "zashi",
];

const SPAM_HINTS = [
  "airdrop",
  "free trading group",
  "trading signals",
  "free signals",
  "join for more free signals",
  "accuracy rate",
  "join now",
  "t.me/",
  "signal group",
  "pump",
  "moonshot",
  "promo code",
  "discount code",
  "coupon",
  "voucher code",
  "كود خصم",
  "كوبون",
];

const DISCOVERY_BASE_TERM_REGEX = /(?:\bzcash\b|\bzodl\b|\bzashi\b)/i;
const DISCOVERY_NOISE_HINTS = [
  "trading signals",
  "free signals",
  "join for more free signals",
  "accuracy rate",
  "xauusd",
  "btcusd",
  "join now",
  "vip group",
  "premium signals",
];

const SUMMARY_THEME_KEYWORDS = {
  "Governance / strategy": [
    "governance",
    "consensus",
    "nu7",
    "nu6",
    "roadmap",
    "poll",
    "polling",
    "zsa",
    "shielded asset",
    "fee burning",
    "arborist",
    "zcashd",
    "grants",
  ],
  "Privacy / freedom narrative": [
    "privacy",
    "private",
    "surveillance",
    "freedom",
    "censorship",
    "encrypted",
    "shielded",
    "civil liberties",
  ],
  "Market / price": [
    "zec",
    "price",
    "btc",
    "bitcoin",
    "ath",
    "stack",
    "buy",
    "market cap",
    "bull",
    "bear",
  ],
  "Product / ecosystem": [
    "wallet",
    "zashi",
    "integration",
    "release",
    "upgrade",
    "partnership",
    "sdk",
    "api",
    "zodl",
    "foundation",
    "commgrants",
    "shieldedlabs",
  ],
  "Community / memes": [
    "gm",
    "meme",
    "lol",
    "lfg",
    "vibes",
    "blessed",
    "replying to",
  ],
};

const SUMMARY_DEBATE_ISSUES = {
  "ZSA direction": {
    keywords: ["zsa", "shielded asset", "shielded assets", "fee burning", "private stables"],
    pro: ["support", "worth", "needed", "should", "important", "bullish", "yes"],
    contra: ["against", "distract", "risk", "oppose", "bad", "concern", "no"],
  },
  "Governance legitimacy": {
    keywords: ["governance", "poll", "polling", "consensus", "nu7", "vote", "voting"],
    pro: ["clear", "majority", "consensus", "agree", "valid"],
    contra: ["unclear", "contested", "disagree", "not representative", "invalid"],
  },
  "Execution readiness": {
    keywords: ["arborist", "zcashd", "migration", "upgrade", "audit", "timeline"],
    pro: ["ready", "on track", "solid", "progress"],
    contra: ["blocked", "delay", "not ready", "behind", "risk"],
  },
};

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

function asFiniteFloat(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
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

function normalizeCollectorMode(value, fallback = "priority") {
  const normalized = asString(value).toLowerCase();
  if (COLLECTOR_MODES.has(normalized)) return normalized;
  return fallback;
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

function buildPriorityHandlesOnlyQuery(handles, options) {
  const handlesExpr = handles.map((handle) => `from:${handle}`).join(" OR ");
  const clauses = [`(${handlesExpr})`];
  if (options.excludeRetweets) clauses.push("-is:retweet");
  if (options.excludeQuotes) clauses.push("-is:quote");
  return clauses.join(" ");
}

function buildDiscoveryQuery(baseTerms, options) {
  const clauses = [`(${baseTerms})`];
  if (options.excludeRetweets) clauses.push("-is:retweet");
  if (options.excludeQuotes) clauses.push("-is:quote");
  return clauses.join(" ");
}

function discoveryBaseTerms(baseTerms) {
  const terms = String(baseTerms || "")
    .split(/\s+OR\s+/i)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return String(baseTerms || "");

  const filtered = terms.filter((term) => {
    const normalized = term.replace(/^\(+|\)+$/g, "").trim().toLowerCase();
    return normalized !== "zec" && normalized !== "#zodl";
  });

  return filtered.length > 0 ? filtered.join(" OR ") : String(baseTerms || "");
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

function buildQueryPlan(config, watchlistMap, collectorMode) {
  if (collectorMode === "discovery") {
    const baseTerms = discoveryBaseTerms(config.baseTerms);
    return [
      {
        sourceQuery: "discovery",
        query: buildDiscoveryQuery(baseTerms, config),
        handles: [],
        family: "discovery",
      },
    ];
  }

  const handles = Object.keys(watchlistMap).sort();
  const queries = [];

  // Teammate + ecosystem captures should include all posts from those handles.
  const directCaptureHandles = handles.filter((handle) => {
    const tier = watchlistMap[handle];
    return tier === "teammate" || tier === "ecosystem";
  });
  const directCaptureChunks = chunkHandles(directCaptureHandles, config.handleChunkSize);
  for (const chunk of directCaptureChunks) {
    queries.push({
      sourceQuery: "priority",
      query: buildPriorityHandlesOnlyQuery(chunk, config),
      handles: chunk,
      family: "priority_direct_watchlist",
    });
  }

  // Influencer captures remain term-constrained to prioritize relevant topic coverage.
  const influencerHandles = handles.filter((handle) => watchlistMap[handle] === "influencer");
  const influencerChunks = chunkHandles(influencerHandles, config.handleChunkSize);
  for (const chunk of influencerChunks) {
    queries.push({
      sourceQuery: "priority",
      query: buildPriorityQuery(chunk, config.baseTerms, config),
      handles: chunk,
      family: "priority_influencer_term",
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
  const collectorMode = normalizeCollectorMode(process.env.XMON_COLLECTOR_MODE, "priority");
  const baseTerms = asString(process.env.XMON_X_API_BASE_TERMS) || DEFAULT_BASE_TERMS;

  return {
    collectorEnabled: asBool(process.env.XMON_COLLECTOR_ENABLED, true),
    writeEnabled: asBool(process.env.XMON_COLLECTOR_WRITE_ENABLED, true),
    collectorSource: asString(process.env.XMON_COLLECTOR_SOURCE) || "aws-lambda-x-api",
    collectorMode,
    xApiBearerToken: asString(process.env.XMON_X_API_BEARER_TOKEN),
    xApiBaseUrl: (asString(process.env.XMON_X_API_BASE_URL) || DEFAULT_X_API_BASE_URL).replace(/\/+$/, ""),
    ingestApiBaseUrl: (asString(process.env.XMONITOR_API_BASE_URL) || DEFAULT_INGEST_API_BASE_URL).replace(/\/+$/, ""),
    ingestApiKey: asString(process.env.XMONITOR_API_KEY),
    keywordOmitHandles: new Set(parseHandleList(process.env.XMONITOR_INGEST_OMIT_HANDLES || "")),
    baseTerms,
    baseTermRegex: compileBaseTermRegex(baseTerms),
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
    summaryEnabled: asBool(process.env.XMON_SUMMARY_ENABLED, true),
    summaryAlignHours: asPositiveInt(process.env.XMON_SUMMARY_ALIGN_HOURS, 2),
    summaryTopPosts2h: asPositiveInt(process.env.XMON_SUMMARY_TOP_POSTS_2H, 8),
    summaryTopPosts12h: asPositiveInt(process.env.XMON_SUMMARY_TOP_POSTS_12H, 8),
    summaryFeedPageLimit: asPositiveInt(process.env.XMON_SUMMARY_FEED_PAGE_LIMIT, 20),
    summaryFeedMaxItemsPerWindow: asPositiveInt(process.env.XMON_SUMMARY_FEED_MAX_ITEMS_PER_WINDOW, 2000),
    summaryLlmBackend: asString(process.env.XMON_SUMMARY_LLM_BACKEND || "auto").toLowerCase(),
    summaryLlmUrl: (asString(process.env.XMON_SUMMARY_LLM_URL) || asString(process.env.XMONITOR_COMPOSE_BASE_URL) || DEFAULT_SUMMARY_LLM_URL).replace(/\/+$/, ""),
    summaryLlmModel: asString(process.env.XMON_SUMMARY_LLM_MODEL) || asString(process.env.XMONITOR_COMPOSE_MODEL) || DEFAULT_SUMMARY_LLM_MODEL,
    summaryLlmApiKey: asString(process.env.XMON_SUMMARY_LLM_API_KEY)
      || asString(process.env.XMONITOR_COMPOSE_API_KEY)
      || asString(process.env.XMONITOR_EMBEDDING_API_KEY)
      || asString(process.env.VENICE_API_KEY),
    summaryLlmTemperature: asFiniteFloat(process.env.XMON_SUMMARY_LLM_TEMPERATURE, 0.45),
    summaryLlmMaxTokens: asPositiveInt(process.env.XMON_SUMMARY_LLM_MAX_TOKENS, 900),
    summaryLlmTimeoutMs: asPositiveInt(process.env.XMON_SUMMARY_LLM_TIMEOUT_MS, 180000),
    summaryLlmMaxAttempts: asPositiveInt(process.env.XMON_SUMMARY_LLM_MAX_ATTEMPTS, 3),
    summaryLlmInitialBackoffMs: asPositiveInt(process.env.XMON_SUMMARY_LLM_INITIAL_BACKOFF_MS, 1000),
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

function escapeRegExpLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileBaseTermRegex(baseTerms) {
  const tokens = String(baseTerms || "")
    .split(/\s+OR\s+/i)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/^\(+|\)+$/g, "").trim())
    .map((token) => token.replace(/^["']|["']$/g, "").trim())
    .map((token) => token.replace(/^[$#]+/, "").trim())
    .filter(Boolean);

  const patterns = [];
  for (const token of tokens) {
    const collapsed = token.replace(/\s+/g, " ").trim();
    if (!collapsed) continue;
    const escaped = collapsed
      .split(" ")
      .map((part) => escapeRegExpLiteral(part))
      .join("\\s+");
    if (/^[A-Za-z0-9_ ]+$/.test(collapsed)) {
      patterns.push(`\\b${escaped}\\b`);
    } else {
      patterns.push(escaped);
    }
  }

  if (patterns.length === 0) {
    return DISCOVERY_BASE_TERM_REGEX;
  }
  return new RegExp(`(?:${patterns.join("|")})`, "i");
}

function normalizeSubstanceText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[$#]([A-Za-z0-9_]+)/g, " $1 ")
    .replace(/@[A-Za-z0-9_][A-Za-z0-9_.]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasDiscoveryBaseTerm(text) {
  const normalized = normalizeSubstanceText(text);
  if (!normalized) return false;
  return DISCOVERY_BASE_TERM_REGEX.test(normalized);
}

function hasConfiguredBaseTerm(text, baseTermRegex) {
  const normalized = normalizeSubstanceText(text);
  if (!normalized) return false;
  return baseTermRegex.test(normalized);
}

function isSpamText(text) {
  const low = String(text || "").toLowerCase();
  return SPAM_HINTS.some((hint) => low.includes(hint));
}

function isLowSignalText(text) {
  const cleaned = normalizeSubstanceText(text).toLowerCase();
  if (!cleaned) return true;
  const lowSignalHints = [
    "gm",
    "gn",
    "lfg",
    "wagmi",
    "nice",
    "wow",
    "cool",
    "interesting",
    "bullish",
    "bearish",
    "soon",
    "wen",
    "thread",
    "thoughts?",
  ];
  return cleaned.length < 20 || lowSignalHints.some((hint) => cleaned === hint || cleaned.endsWith(` ${hint}`));
}

function getSubstanceProfile(text) {
  const cleaned = normalizeSubstanceText(text);
  const words = cleaned.match(/[A-Za-z0-9']+/g) || [];
  const meaningfulWords = words.filter((word) => word.length >= 2 && !/^\d+$/.test(word));
  const isReply = /\breplying to\b/i.test(String(text || ""));
  return {
    wordCount: meaningfulWords.length,
    charCount: cleaned.length,
    isReply,
  };
}

function countCashtags(text) {
  const matches = String(text || "").match(/\$[a-z][a-z0-9_]{1,20}/gi);
  return matches ? matches.length : 0;
}

function countHashtags(text) {
  const matches = String(text || "").match(/#[a-z0-9_]{1,30}/gi);
  return matches ? matches.length : 0;
}

function rejectDiscoveryNoisePost(record) {
  const text = String(record?.body_text || "");
  if (!text) return { reject: false, reason: null };
  const low = text.toLowerCase();

  const hint = DISCOVERY_NOISE_HINTS.find((value) => low.includes(value)) || null;
  const cashtags = countCashtags(text);
  const hashtags = countHashtags(text);
  const hasSignalTpPattern = /\btp\d{1,2}\s*[:\-]/i.test(low);
  const hasTgLink = /(t\.me\/|telegram\.me\/)/i.test(low);
  const hasSignalPhrase = /\b(?:free|daily)?\s*(?:trading\s+)?signals?\b/i.test(low);
  const hasTickerBlast = cashtags >= 8 || hashtags >= 10;

  if ((hasSignalPhrase || hasSignalTpPattern || hasTgLink || hint) && (cashtags >= 4 || hashtags >= 6 || hasTickerBlast)) {
    return {
      reject: true,
      reason: hint ? `discovery_noise:${hint}` : "discovery_noise:signal_spam",
    };
  }

  return { reject: false, reason: null };
}

function evaluateSignificance(record) {
  const text = String(record?.body_text || "");
  const low = text.toLowerCase();
  const likes = coerceInt(record?.likes);
  const reposts = coerceInt(record?.reposts);
  const watchTier = asString(record?.watch_tier) || null;

  const { wordCount, charCount, isReply } = getSubstanceProfile(text);
  const hasWatchlist = Boolean(watchTier);

  let keywordReason = null;
  for (const kw of MATERIAL_KEYWORDS) {
    if (low.includes(kw)) {
      keywordReason = `keyword:${kw}`;
      break;
    }
  }
  const hasKeyword = Boolean(keywordReason);

  const engagementModerate = likes >= 25 || reposts >= 10;
  const engagementStrong = reposts >= 8 || (reposts >= 3 && likes >= 100);
  const engagementBalanced = likes >= 50 && reposts >= 5;
  const engagementReason = `engagement:${likes} likes/${reposts} reposts`;

  const substanceOk = isReply ? wordCount >= 8 || charCount >= 55 : wordCount >= 6 || charCount >= 40;
  const spam = isSpamText(text);
  const lowSignal = isLowSignalText(text);

  if ((spam || lowSignal) && !engagementStrong && !hasWatchlist && !hasKeyword) {
    return { isSignificant: false, reason: spam ? "spam" : "low_signal" };
  }

  const reasons = [];
  if (hasWatchlist) {
    if (!(substanceOk || hasKeyword || engagementStrong)) {
      return { isSignificant: false, reason: "low_substance_watchlist" };
    }
    reasons.push(`watchlist:${watchTier}`);
    if (keywordReason) reasons.push(keywordReason);
    if (engagementModerate) reasons.push(engagementReason);
    return { isSignificant: true, reason: reasons.join(";") };
  }

  if (hasKeyword) {
    if (substanceOk || engagementModerate) {
      reasons.push(keywordReason);
      if (engagementModerate) reasons.push(engagementReason);
      return { isSignificant: true, reason: reasons.join(";") };
    }
    return { isSignificant: false, reason: "low_substance_keyword" };
  }

  if ((engagementBalanced && substanceOk) || (engagementStrong && (substanceOk || charCount >= 20))) {
    return { isSignificant: true, reason: engagementReason };
  }

  return { isSignificant: false, reason: "low_substance" };
}

function toOffsetIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace("Z", "+00:00");
}

function alignWindowEndUtc(now, alignHours) {
  const safeAlignHours = Math.max(1, alignHours);
  const date = new Date(now);
  date.setUTCMinutes(0, 0, 0);
  const alignedHour = Math.floor(date.getUTCHours() / safeAlignHours) * safeAlignHours;
  date.setUTCHours(alignedHour);
  return date;
}

function shouldGenerateWindowSummaries(now, alignHours) {
  const safeAlignHours = Math.max(1, alignHours);
  return now.getUTCHours() % safeAlignHours === 0;
}

async function fetchWindowFeedPosts(config, windowStartIso, windowEndIso) {
  const items = [];
  let nextCursor = "";
  let pageCount = 0;
  let truncated = false;

  while (pageCount < config.summaryFeedPageLimit) {
    const url = new URL(`${config.ingestApiBaseUrl}/feed`);
    url.searchParams.set("since", windowStartIso);
    url.searchParams.set("until", windowEndIso);
    url.searchParams.set("limit", "200");
    if (nextCursor) {
      url.searchParams.set("cursor", nextCursor);
    }

    const payload = await fetchJsonWithTimeout(
      url.toString(),
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "xmonitor-xapi-collector/1.0",
        },
      },
      config.ingestTimeoutMs
    );

    pageCount += 1;
    const pageItems = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.data?.items)
        ? payload.data.items
        : [];

    if (pageItems.length === 0) {
      break;
    }

    for (const item of pageItems) {
      items.push(item);
      if (items.length >= config.summaryFeedMaxItemsPerWindow) {
        truncated = true;
        break;
      }
    }

    if (truncated) {
      break;
    }

    nextCursor = asString(payload?.next_cursor) || asString(payload?.data?.next_cursor) || "";
    if (!nextCursor) {
      break;
    }
  }

  return { items, pageCount, truncated };
}

function detectSummaryThemes(text) {
  const low = normalizeSubstanceText(text).toLowerCase();
  if (!low) return [];

  const hits = [];
  for (const [theme, keys] of Object.entries(SUMMARY_THEME_KEYWORDS)) {
    let matched = false;
    for (const key of keys) {
      if (key === "zec") {
        if (/(?:^|[^a-z0-9_])zec(?:$|[^a-z0-9_])/.test(low)) {
          matched = true;
          break;
        }
        continue;
      }
      if (key === "btc") {
        if (/(?:^|[^a-z0-9_])btc(?:$|[^a-z0-9_])/.test(low)) {
          matched = true;
          break;
        }
        continue;
      }
      if (low.includes(key)) {
        matched = true;
        break;
      }
    }
    if (matched) hits.push(theme);
  }

  return hits;
}

function detectSummaryDebateMatches(text) {
  const low = normalizeSubstanceText(text).toLowerCase();
  if (!low) return [];

  const matches = [];
  for (const [issue, config] of Object.entries(SUMMARY_DEBATE_ISSUES)) {
    const hasKeyword = config.keywords.some((keyword) => low.includes(keyword));
    if (!hasKeyword) continue;

    const hasPro = config.pro.some((keyword) => low.includes(keyword));
    const hasContra = config.contra.some((keyword) => low.includes(keyword));

    let stance = "neutral";
    if (hasPro && hasContra) stance = "mixed";
    else if (hasPro) stance = "pro";
    else if (hasContra) stance = "contra";

    matches.push([issue, stance]);
  }

  return matches;
}

function summarizeWindowPosts(posts, topPostsLimit) {
  const tierCounts = {
    teammate: 0,
    influencer: 0,
    ecosystem: 0,
    other: 0,
  };

  const authorCounts = new Map();
  const themeCounts = new Map();
  const debateStats = new Map();

  for (const issue of Object.keys(SUMMARY_DEBATE_ISSUES)) {
    debateStats.set(issue, {
      issue,
      mentions: 0,
      pro: 0,
      contra: 0,
      neutral: 0,
      mixed: 0,
      handles: new Map(),
    });
  }

  let significantCount = 0;
  for (const post of posts) {
    const tierRaw = asString(post?.watch_tier).toLowerCase();
    const tier = tierRaw && ["teammate", "influencer", "ecosystem"].includes(tierRaw) ? tierRaw : "other";
    tierCounts[tier] += 1;

    const handle = normalizeHandle(post?.author_handle);
    if (handle) {
      authorCounts.set(handle, (authorCounts.get(handle) || 0) + 1);
    }

    if (Boolean(post?.is_significant)) {
      significantCount += 1;
    }

    const text = asString(post?.body_text);
    for (const theme of detectSummaryThemes(text)) {
      themeCounts.set(theme, (themeCounts.get(theme) || 0) + 1);
    }

    for (const [issue, stance] of detectSummaryDebateMatches(text)) {
      const stat = debateStats.get(issue);
      if (!stat) continue;
      stat.mentions += 1;
      stat[stance] += 1;
      if (handle) {
        stat.handles.set(handle, (stat.handles.get(handle) || 0) + 1);
      }
    }
  }

  const topAuthors = Array.from(authorCounts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([handle, count]) => ({ handle, count }));

  const topThemes = Array.from(themeCounts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([theme, count]) => ({ theme, count }));

  const debates = Array.from(debateStats.values())
    .filter((item) => item.mentions > 0)
    .map((item) => ({
      issue: item.issue,
      mentions: item.mentions,
      pro: item.pro,
      contra: item.contra,
      neutral: item.neutral,
      mixed: item.mixed,
      top_handles: Array.from(item.handles.entries())
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([handle, count]) => ({ handle, count })),
    }))
    .sort((a, b) => b.mentions - a.mentions);

  const ranked = [...posts].sort((a, b) => {
    const scoreA = coerceInt(a?.likes) + 2 * coerceInt(a?.reposts) + (coerceInt(a?.views) / 1000) + (a?.is_significant ? 5 : 0);
    const scoreB = coerceInt(b?.likes) + 2 * coerceInt(b?.reposts) + (coerceInt(b?.views) / 1000) + (b?.is_significant ? 5 : 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return asString(b?.status_id).localeCompare(asString(a?.status_id));
  });

  const notablePosts = ranked.slice(0, Math.max(1, topPostsLimit)).map((post) => {
    const raw = asString(post?.body_text).replace(/\s+/g, " ").trim();
    const text = raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
    return {
      status_id: asString(post?.status_id),
      author_handle: normalizeHandle(post?.author_handle),
      watch_tier: asString(post?.watch_tier) || "other",
      likes: coerceInt(post?.likes),
      reposts: coerceInt(post?.reposts),
      views: coerceInt(post?.views),
      is_significant: Boolean(post?.is_significant),
      text,
      url: asString(post?.url),
    };
  });

  return {
    postCount: posts.length,
    significantCount,
    tierCounts,
    topThemes,
    debates,
    topAuthors,
    notablePosts,
  };
}

function renderThemeLine(topThemes) {
  if (!Array.isArray(topThemes) || topThemes.length === 0) return "no dominant theme";
  return topThemes
    .slice(0, 5)
    .map((item) => `${item.theme} (${coerceInt(item.count)})`)
    .join(", ");
}

function renderDebateLine(debates) {
  if (!Array.isArray(debates) || debates.length === 0) return "no clear split debates";
  return debates
    .slice(0, 4)
    .map((item) => `${item.issue} (mentions=${coerceInt(item.mentions)}, pro=${coerceInt(item.pro)}, contra=${coerceInt(item.contra)})`)
    .join("; ");
}

function renderAuthorLine(topAuthors) {
  if (!Array.isArray(topAuthors) || topAuthors.length === 0) return "no dominant voices";
  return topAuthors
    .slice(0, 6)
    .map((item) => `@${item.handle} (${coerceInt(item.count)})`)
    .join(", ");
}

function buildWindowSummaryPrompt({
  windowType,
  windowStartIso,
  windowEndIso,
  postCount,
  significantCount,
  topThemes,
  debates,
  topAuthors,
  notablePosts,
}) {
  const targetWords = windowType === "rolling_2h" ? 95 : 150;
  const postLines = [];
  for (const post of (notablePosts || []).slice(0, 8)) {
    postLines.push(
      `- @${post.author_handle} (${coerceInt(post.likes)} likes/${coerceInt(post.reposts)} reposts): ${asString(post.text).trim()}`
    );
  }

  return (
    "Write a concise narrative summary for a dashboard reader.\n"
    + "Use plain English and 1-2 short paragraphs.\n"
    + "Do not use bullet points, section labels, or markdown.\n"
    + "Focus on narrative momentum, notable voices, and where debate is intensifying or cooling.\n"
    + "If evidence is thin, say that explicitly.\n\n"
    + `Target length: about ${targetWords} words.\n`
    + `Window: ${windowType} from ${windowStartIso} to ${windowEndIso}\n`
    + `Posts observed: ${postCount}\n`
    + `Significant posts: ${significantCount}\n`
    + `Top themes: ${renderThemeLine(topThemes)}\n`
    + `Debates: ${renderDebateLine(debates)}\n`
    + `Most active handles: ${renderAuthorLine(topAuthors)}\n`
    + "Notable post excerpts:\n"
    + (postLines.length > 0 ? postLines.join("\n") : "- none")
  );
}

function extractSummaryCompletionText(payload) {
  if (!payload || typeof payload !== "object") return "";

  const direct = asString(payload.output_text) || asString(payload.content);
  if (direct) return direct;

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    const content = choice?.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const parts = content
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item.text === "string") return item.text;
          if (item && typeof item.output_text === "string") return item.output_text;
          return "";
        })
        .filter(Boolean);
      if (parts.length > 0) {
        return parts.join("\n").trim();
      }
    }
  }

  return "";
}

function looksTruncatedNarrative(text) {
  const cleaned = cleanupText(text);
  if (!cleaned) return false;
  if (cleaned.length < 140) return false;
  if (/[.!?]["')\]]?$/.test(cleaned)) return false;
  if (/[,:;\-–—]$/.test(cleaned)) return true;
  if (/[A-Za-z0-9]$/.test(cleaned)) return true;
  return false;
}

async function requestSummaryNarrative(config, model, messages, maxTokens = config.summaryLlmMaxTokens) {
  const payload = await fetchJsonWithTimeout(
    `${config.summaryLlmUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.summaryLlmApiKey}`,
        "content-type": "application/json",
        "user-agent": "xmonitor-xapi-collector/1.0",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: config.summaryLlmTemperature,
        max_tokens: maxTokens,
      }),
    },
    config.summaryLlmTimeoutMs
  );

  const text = extractSummaryCompletionText(payload);
  const cleaned = cleanupText(text);
  if (!cleaned) {
    throw new Error("summary completion returned empty text");
  }
  return cleaned;
}

async function requestSummaryNarrativeWithRetry(config, model, messages, maxTokens = config.summaryLlmMaxTokens) {
  const attempts = Math.max(1, config.summaryLlmMaxAttempts);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestSummaryNarrative(config, model, messages, maxTokens);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(config.summaryLlmInitialBackoffMs * (2 ** (attempt - 1)));
      }
    }
  }

  throw lastError || new Error("summary completion failed");
}

function getSummaryModelCandidates(modelName) {
  const candidates = [];
  const pushCandidate = (value) => {
    const normalized = asString(value);
    if (!normalized) return;
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };

  const configured = asString(modelName);
  pushCandidate(configured);
  if (configured.includes("/")) {
    pushCandidate(configured.split("/", 2)[1]);
  }
  if (candidates.length === 0) {
    pushCandidate(DEFAULT_SUMMARY_LLM_MODEL);
  }
  return candidates;
}

async function generateAiWindowSummaryText(config, input) {
  let backend = asString(config.summaryLlmBackend || "auto").toLowerCase();
  if (["none", "off", "disabled"].includes(backend)) {
    return { text: null, sourceVersion: "v1", model: null, error: null };
  }
  if (!["auto", "openai"].includes(backend)) {
    backend = "auto";
  }

  if (!config.summaryLlmApiKey) {
    return { text: null, sourceVersion: "v1", model: null, error: "missing_summary_llm_api_key" };
  }

  const messages = [
    {
      role: "system",
      content: "You summarize social discussions as coherent narrative for operators. Be concise and factual.",
    },
    {
      role: "user",
      content: buildWindowSummaryPrompt(input),
    },
  ];

  const candidates = getSummaryModelCandidates(config.summaryLlmModel);
  let lastError = null;
  for (const model of candidates) {
    try {
      let text = await requestSummaryNarrativeWithRetry(config, model, messages);
      if (looksTruncatedNarrative(text)) {
        const retryTokens = Math.min(
          1600,
          Math.max(
            config.summaryLlmMaxTokens + 250,
            Math.floor(config.summaryLlmMaxTokens * 1.8)
          )
        );
        const retryText = await requestSummaryNarrativeWithRetry(config, model, messages, retryTokens);
        if (!looksTruncatedNarrative(retryText) || retryText.length > text.length) {
          text = retryText;
        }
      }
      return { text, sourceVersion: "v2_narrative", model, error: null };
    } catch (error) {
      lastError = error;
    }
  }

  if (backend === "openai" && lastError) {
    throw lastError;
  }

  return {
    text: null,
    sourceVersion: "v1",
    model: null,
    error: lastError instanceof Error ? lastError.message : "summary_llm_failed",
  };
}

function buildFallbackSummaryText({
  windowType,
  windowStartIso,
  windowEndIso,
  postCount,
  significantCount,
  topThemes,
  debates,
  topAuthors,
  notablePosts,
}) {
  const lines = [];
  lines.push(`${windowType} summary (${windowStartIso} to ${windowEndIso}): ${postCount} posts, ${significantCount} significant.`);
  if (topThemes.length > 0) {
    lines.push(`Top themes: ${topThemes.slice(0, 4).map((item) => `${item.theme} (${item.count})`).join(", ")}.`);
  }
  if (debates.length > 0) {
    lines.push(
      `Debates: ${debates.slice(0, 3).map((item) => `${item.issue} (mentions=${item.mentions}, pro=${item.pro}, contra=${item.contra})`).join(", ")}.`
    );
  }
  if (topAuthors.length > 0) {
    lines.push(`Most active handles: ${topAuthors.slice(0, 5).map((item) => `@${item.handle} (${item.count})`).join(", ")}.`);
  }
  if (notablePosts.length > 0) {
    lines.push(
      `Notable posts: ${notablePosts.slice(0, 3).map((item) => `@${item.author_handle} ${item.likes}L/${item.reposts}R`).join("; ")}.`
    );
  }
  return lines.join("\n");
}

async function buildWindowSummaryRecord(config, windowType, windowHours, topPostsLimit, alignedWindowEnd) {
  const windowEnd = new Date(alignedWindowEnd);
  const windowStart = new Date(windowEnd.getTime() - (Math.max(1, windowHours) * 3600 * 1000));
  const windowStartIso = toOffsetIso(windowStart);
  const windowEndIso = toOffsetIso(windowEnd);

  const feed = await fetchWindowFeedPosts(config, windowStartIso, windowEndIso);
  const summary = summarizeWindowPosts(feed.items, topPostsLimit);

  const fallbackText = buildFallbackSummaryText({
    windowType,
    windowStartIso,
    windowEndIso,
    postCount: summary.postCount,
    significantCount: summary.significantCount,
    topThemes: summary.topThemes,
    debates: summary.debates,
    topAuthors: summary.topAuthors,
    notablePosts: summary.notablePosts,
  });

  let summaryText = fallbackText;
  let sourceVersion = "v1";
  let llmError = null;
  let llmModel = null;

  try {
    const aiResult = await generateAiWindowSummaryText(config, {
      windowType,
      windowStartIso,
      windowEndIso,
      postCount: summary.postCount,
      significantCount: summary.significantCount,
      topThemes: summary.topThemes,
      debates: summary.debates,
      topAuthors: summary.topAuthors,
      notablePosts: summary.notablePosts,
    });
    if (aiResult?.text) {
      summaryText = aiResult.text;
      sourceVersion = aiResult.sourceVersion || "v2_narrative";
      llmModel = aiResult.model || null;
    } else if (aiResult?.error) {
      llmError = aiResult.error;
    }
  } catch (error) {
    llmError = error instanceof Error ? error.message : "summary_llm_failed";
  }

  const generatedAt = toOffsetIso(new Date());
  const summaryKey = `${windowType}:${windowStartIso}:${windowEndIso}`;
  return {
    item: {
      summary_key: summaryKey,
      window_type: windowType,
      window_start: windowStartIso,
      window_end: windowEndIso,
      generated_at: generatedAt,
      post_count: summary.postCount,
      significant_count: summary.significantCount,
      tier_counts: summary.tierCounts,
      top_themes: summary.topThemes,
      debates: summary.debates,
      top_authors: summary.topAuthors,
      notable_posts: summary.notablePosts,
      summary_text: summaryText,
      source_version: sourceVersion,
    },
    metrics: {
      window_type: windowType,
      window_start: windowStartIso,
      window_end: windowEndIso,
      generated_at: generatedAt,
      post_count: summary.postCount,
      significant_count: summary.significantCount,
      source_version: sourceVersion,
      llm_model: llmModel,
      llm_error: llmError,
      fetch_pages: feed.pageCount,
      fetch_posts: feed.items.length,
      fetch_truncated: feed.truncated,
    },
  };
}

async function maybeGenerateWindowSummaries(config, collectorMode, dryRun, event) {
  if (collectorMode !== "discovery") {
    return { skipped: true, reason: "collector_mode_not_discovery", windows: [] };
  }
  if (!config.summaryEnabled) {
    return { skipped: true, reason: "summary_disabled", windows: [] };
  }

  const now = new Date();
  const force = asBool(event?.forceWindowSummaries ?? event?.force_window_summaries, false);
  const shouldGenerate = force || shouldGenerateWindowSummaries(now, config.summaryAlignHours);
  if (!shouldGenerate) {
    return {
      skipped: true,
      reason: "not_aligned_hour",
      align_hours: config.summaryAlignHours,
      current_utc_hour: now.getUTCHours(),
      windows: [],
    };
  }

  const alignedWindowEnd = alignWindowEndUtc(now, config.summaryAlignHours);
  const alignedWindowEndIso = toOffsetIso(alignedWindowEnd);
  const requests = [
    { windowType: "rolling_2h", windowHours: 2, topPosts: config.summaryTopPosts2h },
    { windowType: "rolling_12h", windowHours: 12, topPosts: config.summaryTopPosts12h },
  ];

  const items = [];
  const windows = [];
  for (const req of requests) {
    try {
      const built = await buildWindowSummaryRecord(
        config,
        req.windowType,
        req.windowHours,
        req.topPosts,
        alignedWindowEndIso
      );
      items.push(built.item);
      windows.push({ ok: true, ...built.metrics });
    } catch (error) {
      windows.push({
        ok: false,
        window_type: req.windowType,
        error: error instanceof Error ? error.message : "summary_build_failed",
      });
    }
  }

  if (items.length === 0) {
    return {
      skipped: true,
      reason: "summary_build_failed",
      align_hours: config.summaryAlignHours,
      aligned_window_end: alignedWindowEndIso,
      windows,
    };
  }

  if (dryRun || !config.writeEnabled) {
    return {
      skipped: false,
      dry_run: dryRun,
      write_enabled: config.writeEnabled,
      align_hours: config.summaryAlignHours,
      aligned_window_end: alignedWindowEndIso,
      windows,
      ingest: {
        skipped: true,
        reason: dryRun ? "dry_run" : "writes_disabled",
        received: items.length,
        inserted: 0,
        updated: 0,
        errors: [],
      },
    };
  }

  const response = await postJsonWithTimeout(
    `${config.ingestApiBaseUrl}/ingest/window-summaries/batch`,
    config.ingestApiKey,
    { items },
    config.ingestTimeoutMs
  );

  return {
    skipped: false,
    dry_run: false,
    write_enabled: true,
    align_hours: config.summaryAlignHours,
    aligned_window_end: alignedWindowEndIso,
    windows,
    ingest: {
      skipped: false,
      received: coerceInt(response?.received),
      inserted: coerceInt(response?.inserted),
      updated: coerceInt(response?.updated),
      skipped_items: coerceInt(response?.skipped),
      errors: Array.isArray(response?.errors) ? response.errors : [],
    },
  };
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

  return {
    status_id: String(tweet.id),
    url: `https://x.com/${authorHandle}/status/${tweet.id}`,
    author_handle: authorHandle,
    author_display: authorDisplay,
    body_text: cleanupText(tweet.text),
    posted_relative: null,
    source_query: sourceQuery,
    watch_tier: watchTier,
    is_significant: false,
    significance_reason: null,
    likes: coerceInt(metrics.like_count),
    reposts: coerceInt(metrics.retweet_count),
    replies: coerceInt(metrics.reply_count),
    views: coerceInt(metrics.impression_count),
    discovered_at: toIso(tweet.created_at, seenAtIso),
    last_seen_at: seenAtIso,
  };
}

function shouldKeepTweet(tweet, user, watchlistMap, config, counters, collectorMode) {
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

  if (collectorMode === "priority" && !watchlistMap[authorHandle]) {
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

async function runSearchPlan(config, watchlistMap, queryPlan, collectorMode) {
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
    skippedKeywordOmit: 0,
    skippedMissingDiscoveryBaseTerm: 0,
    skippedMissingPriorityBaseTerm: 0,
    skippedDiscoveryNoise: 0,
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
        if (!shouldKeepTweet(tweet, user, watchlistMap, config, counters, collectorMode)) continue;

        const authorHandle = normalizeHandle(user.username);
        const watchTier = watchlistMap[authorHandle] || null;
        const record = buildPostRecord(tweet, user, entry.sourceQuery, watchTier, seenAtIso);
        if (
          collectorMode === "priority" &&
          (entry.family === "priority_influencer_term" || entry.family === "priority_reply_term") &&
          !hasConfiguredBaseTerm(record.body_text || "", config.baseTermRegex)
        ) {
          counters.skippedMissingPriorityBaseTerm += 1;
          continue;
        }
        if (collectorMode === "discovery" && !watchTier) {
          if (config.keywordOmitHandles.has(authorHandle)) {
            counters.skippedKeywordOmit += 1;
            continue;
          }
          const discoveryNoise = rejectDiscoveryNoisePost(record);
          if (discoveryNoise.reject) {
            counters.skippedDiscoveryNoise += 1;
            continue;
          }
          if (!hasDiscoveryBaseTerm(record.body_text || "")) {
            counters.skippedMissingDiscoveryBaseTerm += 1;
            continue;
          }
        }
        const significance = evaluateSignificance(record);
        record.is_significant = significance.isSignificant;
        record.significance_reason = significance.reason;

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

function buildRunNote(config, counters, posts, collectorMode) {
  const significantCount = posts.filter((item) => item.is_significant).length;
  const replyEnabledForRun = collectorMode === "priority" ? config.replyCaptureEnabled : false;
  const parts = [
    "source=lambda_x_api",
    `collector_mode=${collectorMode}`,
    `queries=${counters.queryCount}`,
    `pages=${counters.pageCount}`,
    `raw=${counters.rawTweets}`,
    `unique=${counters.uniqueTweets}`,
    `significant=${significantCount}`,
    `reply_enabled=${replyEnabledForRun ? 1 : 0}`,
    `reply_mode=${replyEnabledForRun ? config.replyMode : "off"}`,
    `skipped_lang=${counters.skippedLang}`,
    `skipped_non_watchlist=${counters.skippedNonWatchlist}`,
    `skipped_keyword_omit=${counters.skippedKeywordOmit}`,
    `skipped_missing_discovery_base_term=${counters.skippedMissingDiscoveryBaseTerm}`,
    `skipped_discovery_noise=${counters.skippedDiscoveryNoise}`,
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

async function ingestRun(config, counters, posts, dryRun, collectorMode) {
  const significantCount = posts.filter((item) => item.is_significant).length;
  const runPayload = {
    run_at: nowIso(),
    mode: collectorMode,
    fetched_count: counters.uniqueTweets,
    significant_count: significantCount,
    reported_count: 0,
    note: buildRunNote(config, counters, posts, collectorMode),
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

function summarizeResult(config, queryPlan, counters, posts, ingestResult, embeddingResult, runResult, summaryResult, dryRun, collectorMode) {
  return {
    ok: true,
    collector_enabled: config.collectorEnabled,
    write_enabled: config.writeEnabled,
    dry_run: dryRun,
    collector_mode: collectorMode,
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
    summaries: summaryResult,
  };
}

export async function handler(event = {}) {
  const config = getConfig();
  const dryRun = asBool(event?.dryRun ?? process.env.XMON_COLLECTOR_DRY_RUN, false);
  const requestedMode = normalizeCollectorMode(event?.mode ?? event?.collector_mode ?? "", "");
  const collectorMode = requestedMode || config.collectorMode;

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
  if (collectorMode === "priority" && Object.keys(watchlistMap).length === 0) {
    throw new Error("watchlist is empty after applying include filters");
  }

  const queryPlan = buildQueryPlan(config, watchlistMap, collectorMode);
  if (queryPlan.length === 0) {
    throw new Error("query plan is empty");
  }

  const { posts, counters } = await runSearchPlan(config, watchlistMap, queryPlan, collectorMode);

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

  const runResult = await ingestRun(config, counters, posts, dryRun, collectorMode);
  let summaryResult = { skipped: true, reason: "not_attempted", windows: [] };
  try {
    summaryResult = await maybeGenerateWindowSummaries(config, collectorMode, dryRun, event);
  } catch (error) {
    summaryResult = {
      skipped: true,
      reason: "summary_generation_error",
      error: error instanceof Error ? error.message : "summary_generation_error",
      windows: [],
    };
  }

  const summary = summarizeResult(
    config,
    queryPlan,
    counters,
    posts,
    ingestResult,
    embeddingResult,
    runResult,
    summaryResult,
    dryRun,
    collectorMode
  );
  console.log(JSON.stringify(summary));
  return summary;
}
