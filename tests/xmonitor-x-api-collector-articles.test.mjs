import test from "node:test";
import assert from "node:assert/strict";
import {
  ARTICLE_CLASSIFICATION_MODEL,
  ARTICLE_SIGNIFICANCE_REASON,
  ARTICLE_SIGNIFICANCE_VERSION,
  DEFAULT_WATCHLIST_TIERS,
  buildFallbackSummaryText,
  buildPostRecord,
  buildQueryPlan,
  buildSearchUrl,
  buildWindowSummaryPrompt,
  fetchWindowFeedPosts,
  getConfig,
  isArticleTweet,
  requireConfig,
  shouldKeepTweet,
} from "../services/x-api-collector-lambda/index.mjs";

const ARTICLE_TWEET = {
  id: "2030995832808288659",
  author_id: "1765078778475364352",
  created_at: "2026-03-09T13:15:15.000Z",
  lang: "zxx",
  text: "https://t.co/MtgE0AF2eg",
  article: {
    title: "Zcash Open Development Lab Raises $25M+ in Seed Funding",
  },
  entities: {
    urls: [
      {
        url: "https://t.co/MtgE0AF2eg",
        expanded_url: "http://x.com/i/article/2030994367104565248",
        unwound_url: "https://x.com/i/article/2030994367104565248",
      },
    ],
  },
  public_metrics: {
    like_count: 1862,
    retweet_count: 277,
    reply_count: 227,
    impression_count: 818760,
  },
};

const USER = {
  id: "1765078778475364352",
  username: "zodl_app",
  name: "Zodl",
  public_metrics: {
    followers_count: 12000,
  },
  created_at: "2024-03-05T00:00:00.000Z",
  location: "Internet",
};

test("search requests include article metadata fields", () => {
  const url = new URL(buildSearchUrl(
    {
      xApiBaseUrl: "https://api.x.com/2",
      maxResultsPerPage: 100,
    },
    "from:zodl_app has:links -is:retweet",
    null,
    null
  ));

  const fields = url.searchParams.get("tweet.fields").split(",");
  assert.ok(fields.includes("article"));
  assert.ok(fields.includes("entities"));
});

test("article posts use article title as body text and are pre-classified significant", () => {
  const record = buildPostRecord(ARTICLE_TWEET, USER, "priority_article", "teammate", "2026-05-15T12:00:00.000Z");

  assert.equal(isArticleTweet(ARTICLE_TWEET), true);
  assert.match(record.body_text, /^X Article: Zcash Open Development Lab Raises/);
  assert.match(record.body_text, /https:\/\/x\.com\/i\/article\/2030994367104565248/);
  assert.equal(record.is_significant, true);
  assert.equal(record.significance_reason, ARTICLE_SIGNIFICANCE_REASON);
  assert.equal(record.significance_version, ARTICLE_SIGNIFICANCE_VERSION);
  assert.equal(record.classification_status, "classified");
  assert.equal(record.classification_model, ARTICLE_CLASSIFICATION_MODEL);
  assert.equal(record.classification_confidence, 1);
});

test("article posts bypass the language allowlist but non-article zxx posts do not", () => {
  const counters = { skippedLang: 0, skippedMalformed: 0, skippedRetweet: 0, skippedNonWatchlist: 0 };
  const config = {
    excludeRetweets: true,
    enforceLangAllowlist: true,
    langAllowlist: new Set(["en"]),
  };
  const watchlistMap = { zodl_app: "teammate" };

  assert.equal(shouldKeepTweet(ARTICLE_TWEET, USER, watchlistMap, config, counters, "priority"), true);

  const nonArticle = {
    ...ARTICLE_TWEET,
    id: "2030995832808288660",
    text: "https://t.co/notarticle",
    article: undefined,
    entities: { urls: [{ url: "https://t.co/notarticle", expanded_url: "https://example.com" }] },
  };
  assert.equal(shouldKeepTweet(nonArticle, USER, watchlistMap, config, counters, "priority"), false);
  assert.equal(counters.skippedLang, 1);
});

test("priority query plan includes a watchlist article lane", () => {
  const plan = buildQueryPlan(
    {
      articleCaptureEnabled: true,
      handleChunkSize: 10,
      excludeRetweets: true,
      excludeQuotes: false,
      replyCaptureEnabled: false,
      baseTerms: "Zcash OR ZEC OR Zodl",
    },
    {
      zodl_app: "teammate",
      k6nb4k: "influencer",
    },
    "priority"
  );

  const articlePlan = plan.find((entry) => entry.family === "priority_article_watchlist");
  assert.ok(articlePlan);
  assert.equal(articlePlan.sourceQuery, "priority_article");
  assert.match(articlePlan.query, /has:links/);
  assert.match(articlePlan.query, /from:k6nb4k/);
});

test("default watchlist retires active investor mappings", () => {
  const formerInvestorHandles = [
    "a16zcrypto",
    "akshat_hk",
    "balajis",
    "cbventures",
    "chapterone",
    "cryptohayes",
    "davidlee",
    "friedberg",
    "hosseeb",
    "jmj",
    "maelstromfund",
    "paradigm",
    "will_mcevoy",
    "winklevosscap",
  ];

  assert.equal(DEFAULT_WATCHLIST_TIERS.cypherpunk, "ecosystem");
  for (const handle of formerInvestorHandles) {
    assert.equal(DEFAULT_WATCHLIST_TIERS[handle], "influencer");
  }
  assert.equal(Object.values(DEFAULT_WATCHLIST_TIERS).includes("investor"), false);
  const tierCounts = Object.values(DEFAULT_WATCHLIST_TIERS).reduce((counts, tier) => {
    counts[tier] = (counts[tier] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(tierCounts, {
    teammate: 18,
    influencer: 55,
    ecosystem: 10,
  });
});

test("former investor influencers are term-constrained while cypherpunk is direct capture", () => {
  const plan = buildQueryPlan(
    {
      articleCaptureEnabled: false,
      handleChunkSize: 10,
      excludeRetweets: true,
      excludeQuotes: false,
      replyCaptureEnabled: false,
      baseTerms: "Zcash OR ZEC OR Zodl",
    },
    {
      a16zcrypto: DEFAULT_WATCHLIST_TIERS.a16zcrypto,
      cypherpunk: DEFAULT_WATCHLIST_TIERS.cypherpunk,
    },
    "priority"
  );

  const directPlan = plan.find((entry) => entry.family === "priority_direct_watchlist");
  const influencerPlan = plan.find((entry) => entry.family === "priority_influencer_term");
  assert.deepEqual(directPlan?.handles, ["cypherpunk"]);
  assert.deepEqual(influencerPlan?.handles, ["a16zcrypto"]);
  assert.match(influencerPlan?.query || "", /\(Zcash OR ZEC OR Zodl\)/);
});

test("summary narratives use themes and representative posts without debate taxonomy cues", () => {
  const input = {
    windowType: "rolling_2h",
    windowStartIso: "2026-07-20T10:00:00.000Z",
    windowEndIso: "2026-07-20T12:00:00.000Z",
    postCount: 12,
    significantCount: 2,
    topThemes: [{ theme: "Product / ecosystem", count: 7 }],
    topAuthors: [{ handle: "zodl_app", count: 3 }],
    notablePosts: [{ author_handle: "zodl_app", likes: 9, reposts: 2, text: "A new wallet release shipped." }],
  };

  const prompt = buildWindowSummaryPrompt(input);
  assert.match(prompt, /Top themes: Product \/ ecosystem \(7\)/);
  assert.match(prompt, /A new wallet release shipped/);
  assert.doesNotMatch(prompt, /Debates?:/i);
  assert.doesNotMatch(prompt, /intensifying or cooling/i);

  const fallback = buildFallbackSummaryText(input);
  assert.match(fallback, /Top themes: Product \/ ecosystem \(7\)/);
  assert.doesNotMatch(fallback, /Debates?:/i);
});

test("summary feed reads use the dedicated API base and client credentials", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await fetchWindowFeedPosts(
      {
        readApiBaseUrl: "https://read.example/v1",
        readClientId: "collector-priority",
        readClientSecret: "collector-read-secret-with-at-least-32-characters",
        summaryFeedPageLimit: 2,
        summaryFeedMaxItemsPerWindow: 100,
        ingestTimeoutMs: 1000,
      },
      "2026-07-20T10:00:00.000Z",
      "2026-07-20T12:00:00.000Z"
    );

    assert.deepEqual(result, { items: [], pageCount: 1, truncated: false });
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0].url).origin, "https://read.example");
    assert.equal(new URL(requests[0].url).pathname, "/v1/feed");
    assert.equal(requests[0].options.redirect, "manual");
    assert.equal(
      requests[0].options.headers["x-xmonitor-client-id"],
      "collector-priority"
    );
    assert.equal(
      requests[0].options.headers["x-xmonitor-client-secret"],
      "collector-read-secret-with-at-least-32-characters"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("collector config separates read and ingest APIs and summaries require both client credentials", () => {
  const original = {
    XMONITOR_API_BASE_URL: process.env.XMONITOR_API_BASE_URL,
    XMONITOR_READ_API_BASE_URL: process.env.XMONITOR_READ_API_BASE_URL,
    XMONITOR_READ_CLIENT_ID: process.env.XMONITOR_READ_CLIENT_ID,
    XMONITOR_READ_CLIENT_SECRET: process.env.XMONITOR_READ_CLIENT_SECRET,
  };

  process.env.XMONITOR_API_BASE_URL = "https://write.example/v1/";
  process.env.XMONITOR_READ_API_BASE_URL = "https://read.example/v1/";
  process.env.XMONITOR_READ_CLIENT_ID = "collector-client";
  process.env.XMONITOR_READ_CLIENT_SECRET = "collector-read-secret-with-at-least-32-characters";

  try {
    const config = getConfig();
    assert.equal(config.ingestApiBaseUrl, "https://write.example/v1");
    assert.equal(config.readApiBaseUrl, "https://read.example/v1");
    assert.equal(config.readClientId, "collector-client");
    assert.equal(config.readClientSecret, "collector-read-secret-with-at-least-32-characters");

    assert.throws(
      () => requireConfig({
        ...config,
        writeEnabled: false,
        summaryEnabled: true,
        readClientSecret: "",
      }, { summaryOnly: true, collectorMode: "discovery" }),
      /XMONITOR_READ_CLIENT_SECRET/
    );
    assert.doesNotThrow(() => requireConfig({
      ...config,
      writeEnabled: false,
      summaryEnabled: true,
      readClientId: "",
      readClientSecret: "",
    }, { summaryOnly: true, collectorMode: "priority" }));
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
