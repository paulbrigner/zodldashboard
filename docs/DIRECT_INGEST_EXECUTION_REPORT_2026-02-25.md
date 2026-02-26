# Direct Ingest Transition - Execution Report (2026-02-25 ET)

## Scope executed

- Freeze launchd jobs
- Create SQLite snapshot
- Export JSONL
- Import to AWS Postgres
- Validate counts + spot checks
- Restore launchd jobs

## Operator/runtime context

- AWS account: `860091316962`
- Region: `us-east-1`
- RDS instance: `xmonitor-pg-beta`
- Local machine public IP used temporarily for import: `173.73.136.131`

## Artifacts

- Snapshot: `data/x_monitor.cutover.20260225_193912.db`
- Export dir: `data/export_cutover_20260225_193912`
- Initial reject log (app role): `data/import_rejects_cutover_20260225_193912.ndjson`
- Final reject log (master role): `data/import_rejects_cutover_master_20260225_193912.ndjson`
- Validation output (pre-cleanup): `data/validate_cutover_20260225_193912.json`
- Validation output (final): `data/validate_cutover_post_cleanup_20260225_193912.json`

## Execution results

1. Freeze
- `com.openclaw.xmonitor.priority` and `com.openclaw.xmonitor.discovery` were unloaded successfully.
- No active `x_monitor_dispatch.py`/`x_monitor_sync_api.py` processes remained.

2. Snapshot/export
- `PRAGMA integrity_check` = `ok`
- Exported rows:
  - tweets: `707`
  - reports: `441`
  - watch_accounts: `44`
  - runs: `460`
  - tweet_embeddings: `705`

3. Import (first pass with `xmonitor_app`)
- Import succeeded for posts/reports/runs but rejected restricted tables.
- Rejects: `749`
  - watch_accounts: `44` (`permission denied for table watch_accounts`)
  - embeddings: `705` (`permission denied for table embeddings`)

4. Import (second pass with master role)
- Re-run completed with full table permissions.
- Rejects: `0`
- Upsert results:
  - posts: `707 updated`
  - reports: `441 updated`
  - pipeline_runs: `460 updated`
  - watch_accounts: `43 updated`, `1 inserted`
  - embeddings: `576 updated`, `129 inserted`

5. Validation
- Initial validator output: spot-check passed; `runs` delta `+1` due intentional ingest auth smoke insert.
- Removed synthetic `pipeline_runs` row (`mode='manual'`, `run_at='2026-02-26T00:00:00Z'`).
- Final validator output:
  - tweets: delta `0`
  - reports: delta `0`
  - watch_accounts: delta `0`
  - runs: delta `0`
  - tweet_embeddings: delta `0`
  - spot-check: `50 checked`, `0 missing`, `0 mismatches`

6. API spot checks
- Checked 5 recent `status_id` values against `/api/v1/posts/{statusId}`.
- Result: all present, author/body fields matched snapshot.

7. Scheduler restore
- Manual canary runs:
  - priority: success, API sync ok
  - discovery: success (`refresh-24h` ran, API sync ok)
- launchd jobs re-enabled:
  - `com.openclaw.xmonitor.priority`
  - `com.openclaw.xmonitor.discovery`

8. Security rollback of temporary access
- Added temporary RDS SG ingress for local `/32` only during import.
- Removed temporary SG rule after validation.
- Final RDS SG ingress returned to Lambda SG-only access.

## Stream B direct-ingest cutover update (2026-02-25 19:59 ET)

- Added new direct-ingest client:
  - `~/.openclaw/workspace/scripts/x_monitor_ingest_api.py`
- Updated dispatcher runtime path:
  - from `x_monitor_dispatch.py -> x_monitor_sync_api.py`
  - to `x_monitor_dispatch.py -> x_monitor_ingest_api.py`
- Dispatcher now sends run-scoped ingest with:
  - `--since <run_start_utc>`
  - bounded retry/backoff in the ingest client (`max-attempts`, exponential backoff)
- Verified with manual canaries:
  - priority run: `api ingest ok`
  - discovery run: `api ingest ok`
- Verified with launchd kickstart:
  - priority log now shows `ingest: ... x_monitor_ingest_api.py` and `api ingest ok`

## Remaining follow-up

- Collector still uses local SQLite for local scoring/state before ingest; full server-side ownership (removing local SQLite correctness dependency) remains a later phase.

## Guardrails execution update (2026-02-25/26 ET)

### G1 catch-up hardening

- launchd env confirmed:
  - `XMONITOR_INGEST_LOOKBACK_SECONDS=900`
  - `XMONITOR_INGEST_MAX_ATTEMPTS=4`
  - `XMONITOR_INGEST_INITIAL_BACKOFF_SECONDS=1`
- Verified in recent dispatcher runs:
  - ingest invocation includes `--lookback-seconds 900`
  - successful cycles log `api ingest ok`

### G2 consecutive failure alerting

- Dispatcher now persists ingest health by mode:
  - `~/.openclaw/workspace/memory/x_monitor_ingest_health.json`
- Drill executed twice with unreachable API:
  - command used: `--api-base-url https://127.0.0.1:9`
  - first run: failure recorded
  - second run: emitted threshold alert
    - `ALERT: ingest failures threshold reached mode=priority consecutive_failures=2 threshold=2 ...`
- Reset verified:
  - next successful run against prod API reset `consecutive_failures` back to `0`.

### G3 daily reconciliation

- Stream A endpoint implemented and deployed:
  - `GET /v1/ops/reconcile-counts?since=<iso>`
  - unauthorized test: `401`
  - authorized test: `200` with counts payload
- Stream B scheduler:
  - LaunchAgent `com.openclaw.xmonitor.reconcile`
  - schedule `05:10 ET`
  - log: `~/.openclaw/workspace/logs/xmonitor-reconcile.log`
  - configured to call backend API directly:
    - `https://84kb8ehtp2.execute-api.us-east-1.amazonaws.com/v1`
- Kickstart validation result:
  - `reconcile PASS`
  - deltas all `0` for posts/reports/pipeline_runs/window_summaries/narrative_shifts

### G4 outage recovery runbook

- Recovery command and post-checks documented in:
  - `docs/DIRECT_INGEST_GUARDRAILS_EXECUTION_PLAN.md`
  - `docs/AWS_MIGRATION_RUNBOOK.md`
