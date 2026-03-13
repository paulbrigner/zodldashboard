import test from "node:test";
import assert from "node:assert/strict";

import { parseTextFilterQuery } from "../shared/xmonitor/text-filter.mjs";

test("parseTextFilterQuery splits required and excluded terms", () => {
  assert.deepEqual(parseTextFilterQuery("mining -foundry"), {
    includeTerms: ["mining"],
    excludeTerms: ["foundry"],
  });
});

test("parseTextFilterQuery preserves quoted phrases", () => {
  assert.deepEqual(parseTextFilterQuery('"mining pool" -"foundry usa"'), {
    includeTerms: ["mining pool"],
    excludeTerms: ["foundry usa"],
  });
});

test("parseTextFilterQuery deduplicates case-insensitively", () => {
  assert.deepEqual(parseTextFilterQuery('Mining mining -Foundry -foundry "Mining"'), {
    includeTerms: ["Mining"],
    excludeTerms: ["Foundry"],
  });
});

test("parseTextFilterQuery handles exclude-only queries", () => {
  assert.deepEqual(parseTextFilterQuery("-foundry"), {
    includeTerms: [],
    excludeTerms: ["foundry"],
  });
});
