import test from "node:test";
import assert from "node:assert/strict";
import {
  SUMMARY_DEBATE_LABELS,
  SUMMARY_THEME_LABELS,
  buildSummaryDebateMatcherGroups,
  buildSummaryThemeMatcherGroups,
  detectSummaryDebateMatches,
  detectSummaryThemes,
  normalizeSummaryDebateFilters,
  normalizeSummaryThemeFilters,
} from "../shared/xmonitor/summary-taxonomy.mjs";

test("normalizeSummaryThemeFilters keeps only known themes in first-seen order", () => {
  assert.deepEqual(
    normalizeSummaryThemeFilters([
      "market / price",
      "Unknown",
      "Governance / strategy,Market / price",
      "Governance / strategy",
    ]),
    ["Market / price", "Governance / strategy"]
  );
});

test("normalizeSummaryDebateFilters keeps only known debate issues", () => {
  assert.deepEqual(
    normalizeSummaryDebateFilters(["Execution readiness", "Nope", "Governance legitimacy"]),
    ["Execution readiness", "Governance legitimacy"]
  );
});

test("detectSummaryThemes matches normalized post text", () => {
  assert.deepEqual(
    detectSummaryThemes("Shielded Labs released a wallet upgrade and Zodl API preview."),
    ["Privacy / freedom narrative", "Product / ecosystem"]
  );
});

test("detectSummaryDebateMatches returns stance for matched debate issues", () => {
  assert.deepEqual(
    detectSummaryDebateMatches("Governance polling feels contested and not representative ahead of the NU7 vote."),
    [["Governance legitimacy", "contra"]]
  );
});

test("matcher groups follow the exported labels", () => {
  assert.equal(buildSummaryThemeMatcherGroups(SUMMARY_THEME_LABELS).length, SUMMARY_THEME_LABELS.length);
  assert.equal(buildSummaryDebateMatcherGroups(SUMMARY_DEBATE_LABELS).length, SUMMARY_DEBATE_LABELS.length);
});
