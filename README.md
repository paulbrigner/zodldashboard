# XMonitor Dashboard

XMonitor is an AWS-backed monitoring system for X activity, with local collection and a hosted feed UI.

## Executive Summary

XMonitor continuously collects prioritized X posts, stores them in PostgreSQL, and exposes them through a private web dashboard and versioned API. The system supports historical search/filtering, post detail views with metric snapshots, and authenticated ingest from local collectors. Ingest writes are protected by a shared secret, while database access remains private inside VPC networking.

## Functional Summary

### 1) Data ingestion

- Local OpenClaw jobs run scheduled collection (`priority`, `discovery`, and refresh workflows).
- Local sync publishes batches to `/v1/ingest/*` endpoints.
- Ingest routes are idempotent upserts keyed by stable identifiers (`status_id`, composite snapshot keys, and run keys).

### 2) Hosted read experience

- Users sign in with Google Workspace auth.
- Feed view supports filtering by tier, handle, date range, significance flag, search text, and cursor pagination.
- Post detail shows snapshots and report state.

### 3) Migration and data integrity

- One-time SQLite export/import scripts exist for reproducible migration.
- Validation tooling checks source vs target counts.
- Historical records and live updates share the same canonical Postgres schema.

### 4) Operational security

- RDS is private and reachable only through Lambda security group rules.
- Ingest writes require a shared secret (`x-api-key` or Bearer token).
- Read API is exposed through the hosted app path and backend API path.

## Technical Summary

### Architecture

1. Local scheduler (`launchd`) triggers `x_monitor_dispatch.py`.
2. Dispatcher calls `x_monitor_sync_api.py`.
3. Sync client posts to hosted API (`/api/v1/ingest/*`).
4. Next.js API proxy forwards to backend API (`/v1/*`) when backend base URL is configured.
5. API Gateway invokes VPC-attached Lambda (`services/vpc-api-lambda/index.mjs`).
6. Lambda reads/writes PostgreSQL in RDS.
7. Amplify hosts the Next.js dashboard and auth flows.

### Key repository areas

- `app/`: Next.js pages and API routes.
- `lib/xmonitor/`: query logic, proxy helpers, validators, ingest auth helper.
- `services/vpc-api-lambda/`: backend Lambda implementation.
- `db/migrations/`: Postgres schema migrations.
- `scripts/migrate/`: SQLite export/import/validation tooling.
- `scripts/aws/provision_vpc_api_lambda.sh`: backend API provisioning and update script.
- `docs/openapi.v1.yaml`: API contract.

### Runtime config model

Read-path API routing:
- `XMONITOR_READ_API_BASE_URL`
- `XMONITOR_BACKEND_API_BASE_URL`

Ingest auth:
- Server side: `XMONITOR_INGEST_SHARED_SECRET`
- Publisher side: `XMONITOR_API_KEY`

Database config:
- `DATABASE_URL` or `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`/`PGSSLMODE`

## Local Development

Prerequisites:
- Node.js 22.x
- npm
- Python 3.10+
- `psql`

Install:

```bash
npm install
```

Run dev server:

```bash
npm run dev
```

Useful routes:
- `/signin`
- `/oauth-probe`
- `/`
- `/posts/{statusId}`

## Database and Migration Commands

Apply migrations:

```bash
DATABASE_URL='postgres://user:pass@localhost:5432/xmonitor' npm run db:migrate
```

Export SQLite:

```bash
python3 scripts/migrate/export_sqlite.py \
  --sqlite-path /Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db \
  --out-dir data/export
```

Import JSONL:

```bash
DATABASE_URL='postgres://user:pass@localhost:5432/xmonitor' \
python3 scripts/migrate/import_sqlite_jsonl_to_postgres.py \
  --input-dir data/export \
  --reject-log data/import_rejects.ndjson
```

Validate counts:

```bash
DATABASE_URL='postgres://user:pass@localhost:5432/xmonitor' \
python3 scripts/migrate/validate_counts.py \
  --sqlite-path data/x_monitor.snapshot.db
```

## Deployment and Operations

Amplify release:

```bash
aws --profile zodldashboard --region us-east-1 amplify start-job \
  --app-id d2rgmein7vsf2e \
  --branch-name main \
  --job-type RELEASE
```

Reprovision backend Lambda/API:

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 ./scripts/aws/provision_vpc_api_lambda.sh
```

Quick checks:

```bash
curl -sS 'https://www.zodldashboard.com/api/v1/health'
curl -sS 'https://www.zodldashboard.com/api/v1/feed?limit=3'
```

Ingest auth check (expected `401` without key):

```bash
curl -i -X POST 'https://www.zodldashboard.com/api/v1/ingest/runs' \
  -H 'content-type: application/json' \
  --data '{"run_at":"2026-02-22T00:00:00Z","mode":"manual"}'
```

## API Surface

OpenAPI source: `docs/openapi.v1.yaml`

Implemented routes:
- `GET /health`
- `GET /feed`
- `GET /posts/{statusId}`
- `POST /ingest/posts/batch`
- `POST /ingest/metrics/batch`
- `POST /ingest/reports/batch`
- `POST /ingest/runs`

## Documentation Map

Current authoritative documents:
- `docs/AWS_MIGRATION_RUNBOOK.md`
- `docs/POSTGRES_SCHEMA_AND_OPENAPI_V1.md`
- `docs/openapi.v1.yaml`
- `docs/ADR-0001-postgres-over-dynamodb.md`

Legacy planning/handoff docs were removed to avoid stale guidance.
