# ZODL Dashboard (X Monitor)

AWS-backed dashboard and API for monitored X activity, with Google Workspace sign-in, filtered feed views, post detail, and ingest endpoints.

## What this repo contains

- A Next.js app (Amplify-hosted) for authenticated dashboard access.
- A VPC-attached Lambda API (`services/vpc-api-lambda`) for read + ingest operations.
- PostgreSQL schema migrations and SQLite migration utilities.
- Operations docs and runbooks for AWS deployment and maintenance.

---

## Current product surface

### Dashboard

- Landing page (`/`) with dashboard tiles.
- X Monitor page (`/x-monitor`) with:
  - filter panel (tier, handle, significant, date range, text, limit),
  - query reference modal,
  - post list + paging,
  - post freshness indicator (3-minute polling, no auto-refresh).
- Post detail page (`/posts/{statusId}`) with snapshots and report state.

### Authentication

- Google Workspace auth via NextAuth.
- Domain restriction using `ALLOWED_GOOGLE_DOMAIN` (default `zodl.com`).

### API

- Read endpoints for health and feed.
- Ingest endpoints for posts, metric snapshots, reports, and run telemetry.
- Ingest auth with shared secret (`x-api-key` or Bearer token).

---

## Architecture

### Write path (collector -> AWS)

1. Local OpenClaw jobs collect/process X data.
2. Collector/sync sends batch ingest payloads to backend `/v1/ingest/*`.
3. Lambda validates payloads and upserts into PostgreSQL (idempotent keys).

### Read path (browser -> dashboard)

1. User authenticates with Google on the Next.js app.
2. Dashboard pages load feed/detail either:
   - from configured read API base URL (`XMONITOR_READ_API_BASE_URL`), or
   - directly from Postgres when local DB vars are present.
3. Feed polling checks for freshness every 3 minutes and enables manual refresh when new data exists.

### Local read modes

- Hosted API mode (recommended for quick UI testing):
  - set `XMONITOR_READ_API_BASE_URL` to deployed API path.
  - no local Postgres required.
- Local DB mode:
  - leave read API base unset.
  - set `DATABASE_URL` or `PG*` vars.

---

## Repository map

- `app/`: Next.js routes, pages, and UI components.
- `lib/`: auth, DB config, validators, repository query/upsert logic.
- `services/vpc-api-lambda/`: backend Lambda code for `/v1/*`.
- `db/migrations/`: PostgreSQL schema migrations.
- `scripts/db/`: migration application shell helper.
- `scripts/migrate/`: SQLite export/import/count validation scripts.
- `scripts/aws/`: backend provisioning script.
- `docs/`: runbooks, schema/OpenAPI, ADRs, roadmap docs.

---

## Prerequisites

- Node.js `>=22 <23`
- npm
- PostgreSQL client (`psql`) for migration script
- Python 3.10+ (migration utilities)
- AWS CLI (for deploy/provision operations)

---

## Quick start (local)

### 1) Install dependencies

```bash
npm install
```

### 2) Create local env file

```bash
cp .env.example .env.local
```

Set at least:

- `NEXTAUTH_URL=http://localhost:3000`
- `NEXTAUTH_SECRET` (generate with `openssl rand -hex 32`)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ALLOWED_GOOGLE_DOMAIN` (usually `zodl.com`)

### 3) Choose your data source mode

#### Option A: Use hosted API (fastest for UI testing)

```env
XMONITOR_READ_API_BASE_URL=https://www.zodldashboard.com/api/v1
XMONITOR_BACKEND_API_BASE_URL=
```

No local DB vars required for read paths.

#### Option B: Use local Postgres

```env
XMONITOR_READ_API_BASE_URL=
XMONITOR_BACKEND_API_BASE_URL=
DATABASE_URL=postgres://user:pass@localhost:5432/xmonitor
```

Then apply schema:

```bash
npm run db:migrate
```

### 4) Run dev server

```bash
npm run dev
```

Open: `http://localhost:3000`

---

## Environment reference

| Variable | Required | Purpose |
|---|---|---|
| `NEXTAUTH_URL` | Yes | Base URL for auth callbacks (local: `http://localhost:3000`). |
| `NEXTAUTH_SECRET` | Yes | Session/JWT secret for NextAuth. |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth web client ID. |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth web client secret. |
| `ALLOWED_GOOGLE_DOMAIN` | Yes | Allowed Workspace domain (default `zodl.com`). |
| `XMONITOR_READ_API_BASE_URL` | Optional | If set, dashboard pages read from this API base instead of direct DB. |
| `XMONITOR_BACKEND_API_BASE_URL` | Optional | If set, local `/api/v1/feed` and `/api/v1/health` proxy to backend `/v1/*`. |
| `XMONITOR_API_PROXY_TIMEOUT_MS` | Optional | Proxy timeout in ms (default `15000`). |
| `XMONITOR_API_SERVICE_NAME` | Optional | API service name in health response (default `xmonitor-api`). |
| `XMONITOR_API_VERSION` | Optional | API version in health response (default `v1`). |
| `XMONITOR_DEFAULT_FEED_LIMIT` | Optional | Default feed page size (default `50`). |
| `XMONITOR_MAX_FEED_LIMIT` | Optional | Max feed page size (default `200`). |
| `XMONITOR_INGEST_SHARED_SECRET` | Required for ingest | Shared secret expected by backend ingest routes. |
| `XMONITOR_API_KEY` | Optional | Compatibility alias for ingest secret if shared secret var is unset. |
| `DATABASE_URL` | Optional* | PostgreSQL DSN. |
| `PGHOST` `PGPORT` `PGDATABASE` `PGUSER` `PGPASSWORD` `PGSSLMODE` | Optional* | Split DB configuration (used when `DATABASE_URL` is unset). |

\* Required only when using local direct DB reads/writes from this app/Lambda runtime.

---

## App and API routes

### App routes

- `/signin`
- `/`
- `/x-monitor`
- `/posts/{statusId}`
- `/oauth-probe` (diagnostic page)

### Next.js API routes in this repo

- `GET /api/v1/health`
- `GET /api/v1/feed`
- `GET|POST /api/auth/[...nextauth]`

### Backend Lambda routes (`/v1`)

- `GET /v1/health`
- `GET /v1/feed`
- `GET /v1/posts/{statusId}`
- `POST /v1/ingest/posts/batch`
- `POST /v1/ingest/metrics/batch`
- `POST /v1/ingest/reports/batch`
- `POST /v1/ingest/runs`

Note: ingest routes are protected by shared-secret auth.

---

## NPM scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local Next.js dev server. |
| `npm run build` | Production build. |
| `npm run start` | Start built app. |
| `npm run typecheck` | Run TypeScript no-emit checks. |
| `npm run db:migrate` | Apply SQL migrations from `db/migrations/*.sql`. |
| `npm run migrate:export` | Export SQLite tables to JSONL. |
| `npm run migrate:import` | Import JSONL into PostgreSQL. |
| `npm run migrate:validate` | Validate row counts and sampled post parity. |

---

## Database migration workflow (SQLite -> Postgres)

### 1) Export SQLite

```bash
python3 scripts/migrate/export_sqlite.py \
  --sqlite-path /Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db \
  --out-dir data/export
```

### 2) Import into Postgres

```bash
DATABASE_URL='postgres://user:pass@host:5432/xmonitor' \
python3 scripts/migrate/import_sqlite_jsonl_to_postgres.py \
  --input-dir data/export \
  --reject-log data/import_rejects.ndjson
```

### 3) Validate counts

```bash
DATABASE_URL='postgres://user:pass@host:5432/xmonitor' \
python3 scripts/migrate/validate_counts.py \
  --sqlite-path data/x_monitor.snapshot.db
```

---

## Deployment and operations

### Amplify release (current project)

```bash
aws --profile zodldashboard --region us-east-1 amplify start-job \
  --app-id d2rgmein7vsf2e \
  --branch-name main \
  --job-type RELEASE
```

### Provision/update backend API + Lambda

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 ./scripts/aws/provision_vpc_api_lambda.sh
```

### Smoke checks

```bash
curl -sS 'https://www.zodldashboard.com/api/v1/health'
curl -sS 'https://www.zodldashboard.com/api/v1/feed?limit=3'
```

Ingest auth (expect `401` without key):

```bash
curl -i -X POST 'https://www.zodldashboard.com/v1/ingest/runs' \
  -H 'content-type: application/json' \
  --data '{"run_at":"2026-02-22T00:00:00Z","mode":"manual"}'
```

---

## Troubleshooting

### Sign-in fails with Google errors

- Verify `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL`.
- Confirm OAuth client callback URL matches your current base URL.
- Confirm account email is verified and matches `ALLOWED_GOOGLE_DOMAIN`.

### X Monitor shows “No feed backend configured”

Set one of:

- `XMONITOR_READ_API_BASE_URL` (hosted/API mode), or
- `DATABASE_URL` / `PG*` (local DB mode).

### Ingest returns `401 unauthorized`

- Ensure caller sends `x-api-key` or `Authorization: Bearer <secret>`.
- Ensure backend `XMONITOR_INGEST_SHARED_SECRET` matches publisher secret.

### Local DB connection errors

- Check `DATABASE_URL` or split `PG*` values.
- Ensure Postgres accepts SSL mode configured by `PGSSLMODE`.
- Re-run `npm run db:migrate` after pointing to target DB.

---

## Documentation index

- `docs/AWS_MIGRATION_RUNBOOK.md`: current production operations and incident checks.
- `docs/POSTGRES_SCHEMA_AND_OPENAPI_V1.md`: canonical schema + API contract notes.
- `docs/openapi.v1.yaml`: OpenAPI source for current API.
- `docs/ADR-0001-postgres-over-dynamodb.md`: storage decision record.
- `docs/DIRECT_INGEST_API_TRANSITION_PLAN.md`: transition plan toward API-first writes.
- `docs/X_MONITOR_X_QUERY_AND_WATCHLIST_REFERENCE.md`: query/watchlist reference used in UI copy.
- `docs/OPENCLAW_NL_QUERY_PARITY_IMPLEMENTATION_PLAN.md`: implementation plan for restoring OpenClaw NL query behavior on AWS.

---

## Known roadmap items

- Semantic/NL retrieval parity is planned but not yet implemented in the live API.
- `pgvector`-based ANN retrieval is documented as future work.
- Polling optimization TODO: lightweight latest-pointer endpoint for freshness checks.

---

## Security notes

- Never commit real secrets in `.env.local`.
- Rotate OAuth and ingest secrets if exposed.
- Keep ingest shared secret only in secure runtime configuration (Amplify env/Secrets Manager).
