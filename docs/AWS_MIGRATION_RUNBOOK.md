# XMonitor AWS Operations Runbook (Current)

_Last updated: 2026-02-26 (ET)_

This runbook describes current production operations for this repository.

## 1) Current production topology

Data path:
1. Local OpenClaw jobs run `x_monitor_dispatch.py`.
2. Dispatcher invokes `x_monitor_ingest_api.py` with run-scoped `--since` selection.
3. Ingest script posts payloads directly to hosted API (`/ingest/*`) with idempotent upserts and bounded retries.
4. Hosted API routes to VPC Lambda API.
5. Lambda writes to RDS PostgreSQL in private subnets.

Read path:
1. Browser requests Amplify-hosted Next.js app.
2. App reads feed/detail via `/api/v1/*`.
3. API proxy forwards to backend API (`/v1/*`) when configured.
4. Backend API queries RDS and returns response.

## 2) Canonical resources

Region: `us-east-1`

Primary resources:
- Amplify app: `d2rgmein7vsf2e` (`main` branch)
- HTTP API: `xmonitor-vpc-api` (`84kb8ehtp2`)
- Lambda: `xmonitor-vpc-api`
- Lambda security group: `sg-0f09791e38a9f68d3`
- RDS security group: `sg-081e2d8e12101d117`
- DB secret: `xmonitor/rds/app`

## 3) Required secrets and env vars

Server-side ingest auth:
- `XMONITOR_INGEST_SHARED_SECRET`

Publisher-side ingest auth:
- `XMONITOR_API_KEY`

API base configuration:
- `XMONITOR_BACKEND_API_BASE_URL`
- `XMONITOR_READ_API_BASE_URL`

Optional API behavior:
- `XMONITOR_DEFAULT_FEED_LIMIT`
- `XMONITOR_MAX_FEED_LIMIT`

## 4) Ingest auth contract

Write routes require one of:
- `x-api-key: <shared-secret>`
- `Authorization: Bearer <shared-secret>`

Routes protected:
- `POST /v1/ingest/posts/batch`
- `POST /v1/ingest/metrics/batch`
- `POST /v1/ingest/reports/batch`
- `POST /v1/ingest/runs`
- `GET /v1/ops/reconcile-counts`

Read routes remain accessible to authenticated app users:
- `GET /v1/health`
- `GET /v1/feed`
- `GET /v1/posts/{statusId}`

## 5) Standard deployment workflow

### 5.1 Code deploy (Amplify)

```bash
aws --profile zodldashboard --region us-east-1 amplify start-job \
  --app-id d2rgmein7vsf2e \
  --branch-name main \
  --job-type RELEASE
```

Check job status:

```bash
aws --profile zodldashboard --region us-east-1 amplify get-job \
  --app-id d2rgmein7vsf2e \
  --branch-name main \
  --job-id <job-id>
```

### 5.2 Backend/Lambda reprovision

Use when Lambda code or backend env wiring changes:

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 ./scripts/aws/provision_vpc_api_lambda.sh
```

## 6) Shared secret rotation

1. Generate new secret:

```bash
openssl rand -hex 32
```

2. Update Secrets Manager secret `xmonitor/rds/app` field `ingest_shared_secret`.
3. Update Amplify branch env `XMONITOR_INGEST_SHARED_SECRET`.
4. Re-run:

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 ./scripts/aws/provision_vpc_api_lambda.sh
```

5. Update publisher auth value (`XMONITOR_API_KEY`) used by local launchd/runtime.
6. Trigger Amplify release.

## 7) Post-deploy verification

Health:

```bash
curl -sS 'https://www.zodldashboard.com/api/v1/health'
```

Feed read:

```bash
curl -sS 'https://www.zodldashboard.com/api/v1/feed?limit=3'
```

Ingest auth should fail without key:

```bash
curl -i -X POST 'https://www.zodldashboard.com/api/v1/ingest/runs' \
  -H 'content-type: application/json' \
  --data '{"run_at":"2026-02-22T00:00:00Z","mode":"manual"}'
```

Ingest auth should pass with key:

```bash
curl -i -X POST 'https://www.zodldashboard.com/api/v1/ingest/runs' \
  -H 'content-type: application/json' \
  -H "x-api-key: $XMONITOR_API_KEY" \
  --data '{"run_at":"2026-02-22T00:00:00Z","mode":"manual"}'
```

## 8) Migration tooling status

The initial SQLite-to-Postgres migration stack is implemented in-repo:
- `scripts/migrate/export_sqlite.py`
- `scripts/migrate/import_sqlite_jsonl_to_postgres.py`
- `scripts/migrate/validate_counts.py`

If a full re-import is required, use a fresh snapshot and rerun import/validate scripts.

## 9) Launchd and local runtime notes

LaunchAgents are currently expected to run local collection + direct ingest on schedule.

If you need to inspect or reconfigure:
- `~/Library/LaunchAgents/com.openclaw.xmonitor.priority.plist`
- `~/Library/LaunchAgents/com.openclaw.xmonitor.discovery.plist`
- `~/Library/LaunchAgents/com.openclaw.xmonitor.reconcile.plist`

If local jobs run but API writes fail, validate:
1. `XMONITOR_API_BASE_URL` points to `https://www.zodldashboard.com/api/v1`
2. `XMONITOR_API_KEY` matches server shared secret
3. `~/.openclaw/workspace/scripts/x_monitor_ingest_api.py --dry-run` returns expected outbound counts
4. ingest endpoint returns `200` for authenticated test payload

Daily reconciliation:
1. LaunchAgent `com.openclaw.xmonitor.reconcile` runs at 05:10 ET.
2. Log path: `~/.openclaw/workspace/logs/xmonitor-reconcile.log`
3. Expected healthy output: `reconcile PASS` with small/zero deltas.

## 10) Incident quick triage

1. `GET /api/v1/health` for top-level service/database signal.
2. Check ingest auth behavior (`401` without key, `200` with key).
3. Check Amplify latest job status/logs.
4. Re-run Lambda provisioning script if backend config drift is suspected.
5. Check CloudWatch logs for Lambda-level SQL or validation failures.

## 11) Guardrails and future migration note

- Guardrail implementation plan: `docs/DIRECT_INGEST_GUARDRAILS_EXECUTION_PLAN.md`
- Full local-SQLite dependency removal is intentionally deferred until guardrail metrics justify the larger refactor.

## 12) Outage recovery and guardrails operations

Recovery replay command (from outage start, with overlap):

```bash
python3 ~/.openclaw/workspace/scripts/x_monitor_ingest_api.py \
  --db ~/.openclaw/workspace/memory/x_monitor.db \
  --api-base-url https://www.zodldashboard.com/api/v1 \
  --api-key "$XMONITOR_API_KEY" \
  --since "<outage_start_utc_iso>" \
  --lookback-seconds 3600 \
  --max-attempts 5
```

Post-recovery checks:
1. `curl -sS 'https://www.zodldashboard.com/api/v1/health'` returns database `ok`.
2. Feed freshness looks current in app/API.
3. Run reconciliation and confirm pass:

```bash
/usr/bin/python3 ~/.openclaw/workspace/scripts/x_monitor_reconcile.py \
  --api-base-url https://84kb8ehtp2.execute-api.us-east-1.amazonaws.com/v1 \
  --since-last-hours 24
```

Failure-alert state file:
- `~/.openclaw/workspace/memory/x_monitor_ingest_health.json`
