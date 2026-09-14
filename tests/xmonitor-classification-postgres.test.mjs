import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import {
  handler, claimPostsForClassification, applySignificanceResults,
  parseSignificanceResultUpsert, parseClassificationRetryRequest, retryFailedClassifications, listExhaustedClassifications,
} from "../services/vpc-api-lambda/index.mjs";

test("classification recovery requires ingest authorization and explicit bounded IDs", async (t) => {
  const previous = process.env.XMONITOR_INGEST_SHARED_SECRET;
  process.env.XMONITOR_INGEST_SHARED_SECRET = "test-ingest-secret";
  t.after(() => previous === undefined ? delete process.env.XMONITOR_INGEST_SHARED_SECRET : process.env.XMONITOR_INGEST_SHARED_SECRET = previous);
  const reply = await handler({ rawPath: "/v1/ops/retry-classification", requestContext: { http: { method: "POST" } }, body: '{"status_ids":["1"],"dry_run":false}' });
  assert.equal(reply.statusCode, 401);
  assert.equal((await handler({ rawPath: "/v1/ops/classification-failures", requestContext: { http: { method: "GET" } } })).statusCode, 401);
  assert.equal(parseClassificationRetryRequest({ status_ids: [] }).ok, false);
  assert.equal(parseClassificationRetryRequest({ status_ids: ["1; DROP TABLE posts"] }).ok, false);
  assert.equal(parseClassificationRetryRequest({ status_ids: Array(201).fill("1") }).ok, false);
  assert.equal(parseClassificationRetryRequest({ status_ids: ["1"], dry_run: "false" }).ok, false);
  assert.deepEqual(parseClassificationRetryRequest({ status_ids: ["1", "1"] }).data, { status_ids: ["1"], dry_run: true });
  assert.equal(parseSignificanceResultUpsert({ status_id: "1", classification_status: "pending" }).ok, false);
});

test("PostgreSQL: lease refunds are idempotent, exhausted posts stay visible, recovery preserves classified posts", {
  skip: !process.env.XMONITOR_TEST_DATABASE_URL,
}, async (t) => {
  const url = new URL(process.env.XMONITOR_TEST_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "integration tests require an isolated local database");
  const db = new Client({ connectionString: url.href });
  await db.connect();
  const schema = `xmonitor_reliability_${process.pid}`;
  t.after(async () => { await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET search_path TO ${schema}, public`);
  for (const file of ["001_init.sql", "008_async_significance_classifier.sql", "017_posts_author_metadata.sql"]) {
    await db.query(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
  }
  for (const [id,status,attempts] of [["1","pending",9],["2","failed",10],["3","classified",10],["4","failed",1],["5","processing",10]]) {
    await db.query(`INSERT INTO posts (status_id,url,author_handle,body_text,discovered_at,last_seen_at,
      classification_status,classification_attempts,classification_model,classification_error,classification_leased_at)
      VALUES ($1,'https://example.com','test','Zcash upgrade',now()-interval '1 hour',now(),$2,$3,'old-model','previous-error',now()-interval '1 hour')`, [id,status,attempts]);
  }
  const claim = await claimPostsForClassification({ limit: 1, max_attempts: 10 }, db);
  assert.equal(claim.items[0].status_id, "1");
  assert.equal(claim.items[0].classification_attempts, 10);
  assert.equal(claim.backlog.exhausted_count, 2);
  const exhausted = await listExhaustedClassifications(db);
  assert.equal(exhausted.total, 1);
  assert.deepEqual(exhausted.items.map((item) => item.status_id), ["2"]);
  const release = parseSignificanceResultUpsert({ status_id: "1", classification_status: "pending", classification_leased_at: claim.items[0].classification_leased_at });
  assert.equal(release.ok, true);
  assert.equal((await applySignificanceResults([release.data], db)).updated, 1);
  assert.equal((await applySignificanceResults([release.data], db)).updated, 0);
  let row = (await db.query("SELECT * FROM posts WHERE status_id='1'")).rows[0];
  assert.equal(row.classification_attempts, 9);
  assert.equal(row.classification_status, "pending");
  const reclaimed = await claimPostsForClassification({ limit: 1, max_attempts: 10 }, db);
  const stale = { ...release.data, classification_leased_at: "2020-01-01T00:00:00.000Z" };
  assert.equal((await applySignificanceResults([stale], db)).updated, 0);
  const success = { ...release.data, classification_leased_at: reclaimed.items[0].classification_leased_at,
    classification_status: "classified", is_significant: true, classification_model: "new-model" };
  assert.equal((await applySignificanceResults([success], db)).updated, 1);
  assert.equal((await applySignificanceResults([{ ...success, classification_status: "failed" }], db)).updated, 0);
  const request = { status_ids: ["2", "3", "5"], dry_run: true };
  assert.equal((await retryFailedClassifications(request, db)).eligible, 1);
  const recovered = await retryFailedClassifications({ ...request, dry_run: false }, db);
  assert.equal(recovered.requeued, 1);
  assert.equal(recovered.items[0].classification_attempts, 10);
  assert.equal(recovered.items[0].classification_error, "previous-error");
  assert.equal((await retryFailedClassifications({ ...request, dry_run: false }, db)).requeued, 0);
  row = (await db.query("SELECT * FROM posts WHERE status_id='2'")).rows[0];
  assert.equal(row.classification_attempts, 0);
  assert.equal(row.classification_error, "previous-error");
  assert.equal((await db.query("SELECT classification_status FROM posts WHERE status_id='3'")).rows[0].classification_status, "classified");
});
