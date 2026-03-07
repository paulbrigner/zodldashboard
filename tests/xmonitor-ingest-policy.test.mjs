import test from "node:test";
import assert from "node:assert/strict";
import omitHandles from "../config/xmonitor/omit-handles.json" with { type: "json" };
import {
  buildOmitHandleSet,
  compileBaseTermRegex,
  hasConfiguredBaseTerm,
  normalizeHandle,
  parseNormalizedHandleList,
  shouldOmitKeywordOriginMissingBaseTerm,
  shouldOmitKeywordOriginPost,
} from "../shared/xmonitor/ingest-policy.mjs";

test("canonical omit handles are normalized and unique", () => {
  const normalized = omitHandles.map((item) => normalizeHandle(item));
  assert.deepEqual(omitHandles, normalized);
  assert.equal(new Set(omitHandles).size, omitHandles.length);
  assert.ok(omitHandles.includes("gingerbroudymag"));
});

test("buildOmitHandleSet merges defaults and env overrides", () => {
  const omitSet = buildOmitHandleSet(["zec_88"], "@NewHandle, zec_88 another_handle");
  assert.equal(omitSet.has("zec_88"), true);
  assert.equal(omitSet.has("newhandle"), true);
  assert.equal(omitSet.has("another_handle"), true);
  assert.equal(omitSet.size, 3);
});

test("parseNormalizedHandleList strips @ and dedupes", () => {
  assert.deepEqual(parseNormalizedHandleList("@One one two"), ["one", "two"]);
});

test("shouldOmitKeywordOriginPost preserves watchlist items", () => {
  const omitSet = buildOmitHandleSet(["zec_88"]);
  assert.equal(
    shouldOmitKeywordOriginPost(
      { source_query: "discovery", watch_tier: null },
      "zec_88",
      omitSet
    ),
    true
  );
  assert.equal(
    shouldOmitKeywordOriginPost(
      { source_query: "discovery", watch_tier: "teammate" },
      "zec_88",
      omitSet
    ),
    false
  );
});

test("shouldOmitKeywordOriginMissingBaseTerm matches backend rules", () => {
  assert.equal(
    shouldOmitKeywordOriginMissingBaseTerm({
      source_query: "discovery",
      watch_tier: null,
      body_text: "Join our premium signals room",
    }),
    true
  );
  assert.equal(
    shouldOmitKeywordOriginMissingBaseTerm({
      source_query: "discovery",
      watch_tier: null,
      body_text: "Zcash and Zashi shipped updates",
    }),
    false
  );
  assert.equal(
    shouldOmitKeywordOriginMissingBaseTerm({
      source_query: "discovery",
      watch_tier: "ecosystem",
      body_text: "premium signals room",
    }),
    false
  );
});

test("compileBaseTermRegex handles configured base terms", () => {
  const regex = compileBaseTermRegex("Zcash OR ZEC OR Zodl OR Zashi");
  assert.equal(hasConfiguredBaseTerm("Watching $ZEC closely", regex), true);
  assert.equal(hasConfiguredBaseTerm("Unrelated forex chatter", regex), false);
});
