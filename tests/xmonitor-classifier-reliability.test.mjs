import test from "node:test";
import assert from "node:assert/strict";
import { handler, parseRetryAfterMs } from "../services/x-significance-classifier-lambda/index.mjs";
import { buildSummaryExcerpt } from "../services/x-api-collector-lambda/index.mjs";

test("summary excerpts preserve emoji pairs and repair invalid Unicode", () => {
  const value = "a".repeat(176) + "😀" + "b".repeat(20);
  const excerpt = buildSummaryExcerpt(value);
  assert.equal(excerpt, "a".repeat(176) + "😀...");
  assert.equal(excerpt.isWellFormed(), true);
  assert.equal(buildSummaryExcerpt("x\ud83dy\u0000z"), "x�y�z");
  assert.equal(buildSummaryExcerpt("😀".repeat(180)), "😀".repeat(180));
});

test("Retry-After supports seconds and HTTP dates", () => {
  assert.equal(parseRetryAfterMs("2"), 2000);
  assert.equal(parseRetryAfterMs("0.025"), 25);
  assert.equal(parseRetryAfterMs("Mon, 14 Sep 2026 10:00:02 GMT", Date.parse("2026-09-14T10:00:00Z")), 2000);
  assert.equal(parseRetryAfterMs("invalid"), 0);
});

async function runClassifier(t, count, chat, remaining = () => 240000, overrides = {}) {
  const keys = {
    XMON_SIGNIFICANCE_INGEST_API_KEY: "test-ingest-secret",
    XMON_SIGNIFICANCE_LLM_API_KEY: "test-model-secret",
    XMON_SIGNIFICANCE_LLM_MODEL: "primary",
    XMON_SIGNIFICANCE_LLM_FALLBACK_MODELS: "fallback",
    XMON_SIGNIFICANCE_LLM_INITIAL_BACKOFF_MS: "1",
    XMON_SIGNIFICANCE_LLM_MAX_ATTEMPTS: "2",
    XMON_SIGNIFICANCE_BATCH_SIZE: "4",
    ...overrides,
  };
  const old = Object.fromEntries(Object.keys(keys).map((key) => [key, process.env[key]]));
  Object.assign(process.env, keys);
  t.after(() => { for (const [key,value] of Object.entries(old)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const posts = Array.from({ length: count }, (_, i) => ({
    status_id: String(i + 1), body_text: "Zcash protocol upgrade", author_handle: "test",
    classification_leased_at: "2026-09-14T10:00:00.123Z",
  }));
  let applied;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const payload = JSON.parse(options.body);
    if (url.endsWith("/claim")) return Response.json({ items: posts, backlog: { exhausted_count: 3 } });
    if (url.endsWith("/batch")) { applied = payload.items; return Response.json({ updated: applied.length, errors: [] }); }
    return chat(payload);
  });
  const result = await handler({}, { getRemainingTimeInMillis: remaining });
  return { result, applied };
}

function validReply(payload) {
  const items = JSON.parse(payload.messages[1].content).items;
  return Response.json({ choices: [{ message: { content: JSON.stringify({ items: items.map((item) => ({
    status_id: item.status_id, significant: true, confidence: 0.9, reason: "Protocol update",
  })) }) } }] });
}

test("429 honors Retry-After, falls back, and avoids the unavailable model for later batches", async (t) => {
  const calls = [];
  const { result, applied } = await runClassifier(t, 6, (payload) => {
    calls.push({ model: payload.model, at: Date.now() });
    return payload.model === "primary"
      ? Response.json({ error: "model overloaded" }, { status: 429, headers: { "Retry-After": "0.025" } })
      : validReply(payload);
  });
  assert.deepEqual(calls.map((v) => v.model), ["primary", "primary", "fallback", "fallback"]);
  assert.ok(calls[1].at - calls[0].at >= 20);
  assert.equal(result.classified, 6);
  assert.equal(result.provider_overloads, 2);
  assert.equal(result.fallback_batches, 2);
  assert.ok(applied.every((v) => v.classification_model === "fallback" && v.classification_leased_at));
});

test("when both models are unavailable only attempted posts fail; untouched posts are released", async (t) => {
  let calls = 0;
  const { result, applied } = await runClassifier(t, 6, () => {
    calls += 1;
    return Response.json({ error: "model overloaded" }, { status: 429 });
  });
  assert.equal(calls, 4);
  assert.equal(result.failed, 4);
  assert.equal(result.deferred, 2);
  assert.deepEqual(applied.map((v) => v.classification_status), ["failed", "failed", "failed", "failed", "pending", "pending"]);
});

test("insufficient Lambda time releases all claimed posts without an AI attempt", async (t) => {
  const { result, applied } = await runClassifier(t, 3, () => assert.fail("AI must not be called"), () => 55000);
  assert.equal(result.failed, 0);
  assert.equal(result.deferred, 3);
  assert.equal(result.time_budget_exhausted, true);
  assert.ok(applied.every((v) => v.classification_status === "pending" && v.classification_leased_at));
});

test("invalid model output is rejected rather than recorded as classified", async (t) => {
  const { result, applied } = await runClassifier(t, 1, () => Response.json({ choices: [{ message: { content: "not json" } }] }));
  assert.equal(result.classified, 0);
  assert.equal(result.failed, 1);
  assert.match(applied[0].classification_error, /invalid JSON/);
});

test("truncated output uses the fallback even if the partial JSON can be parsed", async (t) => {
  const { result, applied } = await runClassifier(t, 4, (payload) => payload.model === "primary"
    ? Response.json({ choices: [{ finish_reason: "length", message: { content: '{"items":[]}' } }] })
    : validReply(payload));
  assert.equal(result.classified, 4);
  assert.ok(applied.every((item) => item.classification_model === "fallback"));
});

test("GLM has enough completion budget for forced reasoning and structured output", async (t) => {
  const { result } = await runClassifier(t, 4, (payload) => {
    assert.equal(payload.max_tokens, 4096);
    assert.equal(payload.reasoning_effort, "low");
    return validReply(payload);
  }, () => 240000, { XMON_SIGNIFICANCE_LLM_MODEL: "z-ai-glm-5-3-flash" });
  assert.equal(result.classified, 4);
});

test("permanent HTTP errors are not retried against other models", async (t) => {
  let calls = 0;
  const { result } = await runClassifier(t, 1, () => {
    calls += 1;
    return Response.json({ error: "invalid request" }, { status: 400 });
  });
  assert.equal(calls, 1);
  assert.equal(result.failed, 1);
});
