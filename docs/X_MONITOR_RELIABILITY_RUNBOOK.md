# X Monitor classifier and database reliability

The September 2026 remediation addresses provider overload, exhausted classification attempts, database connection spikes, and malformed Unicode in summary excerpts. It uses the existing production deployment; there is no staging dependency or schema migration.

## Runtime configuration

- Classifier: Venice `deepseek-v4-flash-0731`, with `z-ai-glm-5-3-flash` as the fallback; batches of four; two requests per model before moving to the fallback. Classification records retain the model actually used and significance version `ai_v3`.
- Retry HTTP 429, server errors, and request timeouts with bounded exponential backoff, jitter, and `Retry-After`. A model that remains unavailable is skipped for the rest of the invocation. Invalid, empty, or truncated structured output is also retried and can use the fallback; permanent HTTP errors remain explicit failures. GLM uses low reasoning effort and at least 4096 completion tokens because the legacy thinking-disable flag did not prevent hidden reasoning in production.
- If no model request occurs, return the post to pending and refund its claim attempt. The API requires the matching processing lease before refunding, making duplicate and stale releases harmless. Deploy the API before the classifier; legacy classified/failed responses remain accepted during rollout.
- PostgreSQL pools: maximum two clients per Lambda environment, one-second idle timeout, five-second connection timeout, and a 60-second client lifetime. Reserved concurrency is 10 for the API, two for compose workers, one for the email scheduler, and one for the classifier. These limits bound concurrent work; monitor API throttles before increasing them.
- Summary excerpts are repaired to well-formed Unicode and truncated by code points, preserving complete emoji. Existing summary and compose model selections are unchanged.

Review the narrow settings plan before applying it:

```sh
python3 scripts/aws/configure_xmonitor_reliability.py
python3 scripts/aws/configure_xmonitor_reliability.py --apply --backup-dir /absolute/private/backup-directory
```

The helper preserves all unrelated environment variables, uses the current Lambda revision, saves owner-only configuration backups outside the repository, and verifies the resulting environment and concurrency. Deploy the matching source code first. It does not provision IAM, collectors, schedules, or a database proxy.

## Recover specific failed posts

The authenticated Lambda handler accepts `POST /v1/ops/retry-classification` with `{ "status_ids": ["..."], "dry_run": true }`. This is an operator path invoked directly through AWS Lambda; no public API Gateway route is required. Supply the existing ingest credential as `x-api-key`, never in shell history, console output, or Git.

1. Inspect `GET /v1/ops/classification-failures` through an authenticated direct Lambda invocation. It returns at most 200 exhausted failed rows plus the total count, without post text. Export the exact affected IDs and their current failure metadata to a private file.
2. Invoke `xmonitor-vpc-api` with an HTTP-style Lambda event (`rawPath`, `requestContext.http.method`, `headers`, and JSON-string `body`) and `dry_run: true`. Verify eligible rows against the intended incident.
3. Invoke the same event with `dry_run: false`. Only failed rows among the explicit IDs are requeued. Their previous attempt count, model, and error are returned for the private recovery audit. Classified or actively processing posts are untouched.
4. Let the classifier schedule run, or invoke it sequentially. Verify each recovered ID through the authenticated post read endpoint and verify the exhausted-post metric returns to zero.

The request requires 1–200 numeric string IDs and defaults to dry-run. A repeated recovery request cannot reset an already recovered or processing row. The requeue keeps previous provenance until a new claim/result; retain the returned before-state separately.

## Regenerate affected summaries

Use the explicit original time boundary, including timezone. The helper's default is a read-only plan; `--apply` reads current discovery-collector settings into memory, rebuilds one window, and ingests it without collecting X posts or advancing cursors:

```sh
node scripts/ops/regenerate_xmonitor_summary.mjs --window-type rolling_2h --window-end 2026-09-12T12:00:00Z
node scripts/ops/regenerate_xmonitor_summary.mjs --window-type rolling_2h --window-end 2026-09-12T12:00:00Z --apply
```

Supported types are `rolling_2h`, `rolling_12h`, and `rolling_7d_daily`. The helper refuses to persist a truncated feed or a fallback summary produced after an AI error. Review recovered significant posts when choosing additional historical windows. Refresh the latest affected summary after recovery.

## Alarms and rollback

```sh
python3 scripts/aws/provision_xmonitor_reliability_alarms.py
python3 scripts/aws/provision_xmonitor_reliability_alarms.py --apply
```

Five alarms reuse the existing X Monitor SNS alarm destination: high RDS connections, sustained low RDS memory, exhausted classifications, sustained provider overload, and classification persistence errors. Existing alarm definitions and subscribers are preserved.

Before a release, save the exact deployed ZIP, full Lambda configuration, and reserved-concurrency state for all affected functions outside Git with owner-only permissions. Deploy by replacing `index.mjs` in each function's saved ZIP to retain its exact installed dependencies and supporting files; verify the resulting code hash and successful update status. For rollback, restore each original ZIP and the full original environment, restore its original reserved-concurrency setting (delete the reservation if originally absent), wait for successful updates, and smoke-test the API and classifier. Restore only alarm definitions changed by this rollout; newly added alarms can be deleted separately. A code/configuration rollback does not undo recovered post classifications.

## Verification

```sh
npm run typecheck
node --test tests/xmonitor-classifier-reliability.test.mjs tests/xmonitor-classification-postgres.test.mjs
git diff --check
```

Set `XMONITOR_TEST_DATABASE_URL` to a disposable local PostgreSQL 15 database to run the lease/recovery integration test; it rejects remote hosts, creates its own temporary schema, and removes it afterward. Without that variable the database test is skipped. The tests cover primary overload, fallback provenance, bounded attempts, unattempted-post deferral, malformed AI responses, emoji boundaries, stale/duplicate lease responses, exhausted counts, and targeted idempotent recovery.

Venice documents that reasoning and visible answers share the completion token cap: [reasoning models](https://docs.venice.ai/guides/features/reasoning-models). Real-post validation, rather than the initial synthetic smoke test, determined the final primary/fallback ordering.
