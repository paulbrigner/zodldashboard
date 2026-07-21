import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActivityTrendsApiUrl,
  buildCuratedBriefingApiUrl,
  buildCuratedBriefingsApiUrl,
  buildFeedApiUrl,
  buildPostDetailApiUrl,
  createXMonitorReadClient,
} from "../packages/x-monitor-core/src/read-client.ts";

test("feed URL preserves repeated filters, cursor, and explicit significance", () => {
  const url = new URL(buildFeedApiUrl("https://api.example.test/v1/", {
    since: "2026-07-01T00:00:00.000Z",
    until: "2026-07-20T00:00:00.000Z",
    tiers: ["teammate", "ecosystem"],
    themes: ["Privacy / freedom narrative", "Product / ecosystem"],
    debate_issues: ["Execution readiness"],
    handle: "cypherpunk",
    significant: false,
    min_followers: 100,
    max_followers: 5000,
    min_account_age_days: 30,
    max_account_age_days: 4000,
    location: "New York",
    q: 'privacy "wallet release"',
    limit: 75,
    cursor: "2026-07-20T00:00:00.000Z|123/456",
  }));

  assert.equal(url.pathname, "/v1/feed");
  assert.deepEqual(url.searchParams.getAll("tier"), ["teammate", "ecosystem"]);
  assert.deepEqual(url.searchParams.getAll("theme"), [
    "Privacy / freedom narrative",
    "Product / ecosystem",
  ]);
  assert.deepEqual(url.searchParams.getAll("debate_issue"), ["Execution readiness"]);
  assert.equal(url.searchParams.get("significant"), "false");
  assert.equal(url.searchParams.get("cursor"), "2026-07-20T00:00:00.000Z|123/456");
  assert.equal(url.searchParams.get("q"), 'privacy "wallet release"');
});

test("omitted significance keeps the existing explicit any-value query behavior", () => {
  const url = new URL(buildFeedApiUrl("https://api.example.test/v1", {}));
  assert.equal(url.searchParams.has("significant"), true);
  assert.equal(url.searchParams.get("significant"), "");
});

test("trends URL excludes pagination and includes semantic range options", () => {
  const url = new URL(buildActivityTrendsApiUrl(
    "https://api.example.test/v1",
    { tiers: ["influencer"], significant: true, limit: 75, cursor: "not-for-trends" },
    { searchMode: "semantic", trendRange: "30d" }
  ));

  assert.equal(url.pathname, "/v1/trends");
  assert.equal(url.searchParams.get("tier"), "influencer");
  assert.equal(url.searchParams.get("significant"), "true");
  assert.equal(url.searchParams.get("search_mode"), "semantic");
  assert.equal(url.searchParams.get("trend_range"), "30d");
  assert.equal(url.searchParams.has("limit"), false);
  assert.equal(url.searchParams.has("cursor"), false);
});

test("post-detail URL encodes the status ID as one path segment", () => {
  assert.equal(
    buildPostDetailApiUrl("https://api.example.test/v1/", "123/456 ?"),
    "https://api.example.test/v1/posts/123%2F456%20%3F"
  );
});

test("curated briefing URLs stay under the read-only briefing namespace", () => {
  assert.equal(
    buildCuratedBriefingsApiUrl("https://api.example.test/v1/"),
    "https://api.example.test/v1/curated-briefings"
  );
  assert.equal(
    buildCuratedBriefingApiUrl("https://api.example.test/v1", "Quantum-Readiness"),
    "https://api.example.test/v1/curated-briefings/quantum-readiness"
  );
  assert.throws(
    () => buildCuratedBriefingApiUrl("https://api.example.test/v1", "not/a/slug"),
    /valid slug/
  );
});

test("read client uses injected fetch, no-store, and validates all public reads", async () => {
  const requests = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    if (url.pathname.endsWith("/feed")) {
      return Response.json({ items: [], next_cursor: "next" });
    }
    if (url.pathname.endsWith("/window-summaries/latest")) {
      return Response.json({ items: [] });
    }
    if (url.pathname.endsWith("/author-locations")) {
      return Response.json({ items: ["NYC", "", null, "Berlin"] });
    }
    if (url.pathname.endsWith("/trends")) {
      return Response.json({
        scope: {
          since: "2026-07-01T00:00:00.000Z",
          until: "2026-07-20T00:00:00.000Z",
          bucket_hours: 12,
          range_key: "7d",
          text_filter_applied: true,
        },
        activity: { totals: { post_count: 0 }, buckets: [] },
      });
    }
    if (url.pathname.endsWith("/posts/missing")) {
      return new Response(null, { status: 404 });
    }
    if (url.pathname.endsWith("/curated-briefings/missing")) {
      return new Response(null, { status: 404 });
    }
    if (url.pathname.endsWith("/curated-briefings")) {
      return Response.json({ items: [], generated_at: "2026-07-21T00:00:00.000Z" });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const client = createXMonitorReadClient({
    baseUrl: "https://api.example.test/v1",
    fetch: fetchImpl,
    headers: { "x-client": "test" },
  });

  assert.deepEqual(await client.feed({ significant: true }), {
    items: [],
    next_cursor: "next",
  });
  assert.deepEqual(await client.latestSummaries(), { items: [] });
  assert.deepEqual(await client.authorLocations(10), { items: ["NYC", "Berlin"] });
  assert.equal(
    (await client.activityTrends({}, { searchMode: "keyword", trendRange: "7d" }))
      .activity.buckets.length,
    0
  );
  assert.equal(await client.postDetail("missing"), null);
  assert.deepEqual(await client.curatedBriefings(), {
    items: [],
    generated_at: "2026-07-21T00:00:00.000Z",
  });
  assert.equal(await client.curatedBriefing("missing"), null);

  assert.equal(requests.length, 7);
  for (const request of requests) {
    assert.equal(request.init.cache, "no-store");
    assert.equal(request.init.redirect, "manual");
    assert.equal(new Headers(request.init.headers).get("x-client"), "test");
  }
});

test("read client surfaces upstream JSON errors and rejects malformed payloads", async () => {
  const errorClient = createXMonitorReadClient({
    baseUrl: "https://api.example.test/v1",
    fetch: async () => Response.json({ error: "backend unavailable" }, { status: 503 }),
  });
  await assert.rejects(() => errorClient.feed({}), /backend unavailable/);

  const malformedClient = createXMonitorReadClient({
    baseUrl: "https://api.example.test/v1",
    fetch: async () => Response.json({ items: "not-an-array" }),
  });
  await assert.rejects(() => malformedClient.feed({}), /Invalid feed response payload/);

  const textErrorClient = createXMonitorReadClient({
    baseUrl: "https://api.example.test/v1",
    fetch: async () => new Response("unavailable", { status: 502 }),
  });
  await assert.rejects(() => textErrorClient.latestSummaries(), /API request failed \(502\)/);
});

test("read client validates every public response shape", async () => {
  const client = createXMonitorReadClient({
    baseUrl: "https://api.example.test/v1",
    fetch: async () => Response.json({}),
  });

  await assert.rejects(() => client.latestSummaries(), /Invalid window summary response payload/);
  await assert.rejects(() => client.authorLocations(), /Invalid author location response payload/);
  await assert.rejects(
    () => client.activityTrends({}, { searchMode: "keyword", trendRange: "7d" }),
    /Invalid trends response payload/
  );
  await assert.rejects(() => client.postDetail("123"), /Invalid post detail response payload/);
  await assert.rejects(() => client.curatedBriefings(), /Invalid curated briefings response payload/);
  await assert.rejects(() => client.curatedBriefing("topic"), /Invalid curated briefing response payload/);
});
