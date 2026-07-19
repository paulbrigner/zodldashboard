import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scheduledEmailAdminInventoryFromRows } from "../services/vpc-api-lambda/index.mjs";

const backendSourceUrl = new URL("../services/vpc-api-lambda/index.mjs", import.meta.url);
const appRouteSourceUrl = new URL("../app/api/v1/admin/email-schedules/route.ts", import.meta.url);

test("admin schedule inventory reports adoption counts and timestamps without schedule content", () => {
  const inventory = scheduledEmailAdminInventoryFromRows(
    [
      {
        owner_email: "OWNER.ONE@ZODL.COM",
        personal_enabled_count: 2,
        personal_disabled_count: 1,
        shared_enabled_count: 0,
        shared_disabled_count: 0,
        first_created_at: "2026-01-01T12:00:00.000Z",
        latest_created_at: "2026-02-01T12:00:00.000Z",
        latest_last_run_at: "2026-07-18T12:00:00.000Z",
        earliest_next_run_at: "2026-07-20T12:00:00.000Z",
        recipients_json: ["must-not-leak@example.com"],
        compose_request_json: { prompt: "must not leak" },
        subject_override: "must not leak",
      },
      {
        owner_email: "owner.two@zodl.com",
        personal_enabled_count: 0,
        personal_disabled_count: 0,
        shared_enabled_count: 1,
        shared_disabled_count: 1,
        first_created_at: "2026-03-01T12:00:00.000Z",
        latest_created_at: "2026-04-01T12:00:00.000Z",
        latest_last_run_at: "2026-07-19T12:00:00.000Z",
        earliest_next_run_at: "2026-07-21T12:00:00.000Z",
      },
    ],
    "2026-07-19T16:00:00.000Z"
  );

  assert.deepEqual(inventory.summary.counts, {
    total: 5,
    enabled: 3,
    disabled: 2,
    personal: { total: 3, enabled: 2, disabled: 1 },
    shared: { total: 2, enabled: 1, disabled: 1 },
  });
  assert.equal(inventory.summary.owner_count, 2);
  assert.equal(inventory.summary.owners_with_personal_schedules, 1);
  assert.equal(inventory.summary.owners_with_shared_schedules, 1);
  assert.equal(inventory.summary.first_created_at, "2026-01-01T12:00:00.000Z");
  assert.equal(inventory.summary.latest_created_at, "2026-04-01T12:00:00.000Z");
  assert.equal(inventory.summary.latest_last_run_at, "2026-07-19T12:00:00.000Z");
  assert.equal(inventory.summary.earliest_next_run_at, "2026-07-20T12:00:00.000Z");
  assert.equal(inventory.owners[0].owner_email, "owner.one@zodl.com");

  const serialized = JSON.stringify(inventory);
  assert.doesNotMatch(serialized, /must-not-leak/);
  assert.doesNotMatch(serialized, /recipients_json|compose_request_json|subject_override/);
});

test("admin schedule inventory returns a stable empty aggregate", () => {
  const inventory = scheduledEmailAdminInventoryFromRows([], "2026-07-19T16:00:00.000Z");

  assert.equal(inventory.summary.owner_count, 0);
  assert.deepEqual(inventory.summary.counts, {
    total: 0,
    enabled: 0,
    disabled: 0,
    personal: { total: 0, enabled: 0, disabled: 0 },
    shared: { total: 0, enabled: 0, disabled: 0 },
  });
  assert.equal(inventory.summary.first_created_at, null);
  assert.equal(inventory.summary.latest_last_run_at, null);
  assert.deepEqual(inventory.owners, []);
});

test("admin schedule inventory is permission-gated in both layers and queries aggregates only", async () => {
  const [backendSource, appRouteSource] = await Promise.all([
    readFile(backendSourceUrl, "utf8"),
    readFile(appRouteSourceUrl, "utf8"),
  ]);

  assert.match(appRouteSource, /requireManageAccessPermission\(viewer\)/);
  assert.match(appRouteSource, /buildViewerProxyHeaders\(admin\.viewer\)/);
  assert.match(backendSource, /async function listScheduledEmailAdminInventory\(viewer\)\s*{\s*await requireAccessAdmin\(viewer\.email\)/);
  assert.match(backendSource, /method === "GET" && path === "\/v1\/admin\/email-schedules"/);

  const queryMatch = backendSource.match(
    /async function listScheduledEmailAdminInventory\(viewer\)[\s\S]*?getPool\(\)\.query\(`([\s\S]*?)`\);/
  );
  assert.ok(queryMatch, "admin inventory aggregate query must remain discoverable");
  const query = queryMatch[1];
  assert.match(query, /GROUP BY lower\(owner_email::text\)/);
  assert.doesNotMatch(
    query,
    /job_id|\bname\b|recipients_json|compose_request_json|subject_override|last_error/,
    "admin inventory SQL must not select schedule identity or content fields"
  );
});
