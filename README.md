# ZODL Dashboard (X Monitor)

## Executive Summary
ZODL Dashboard is an authenticated web app and API for monitoring selected X posts, storing them in PostgreSQL, and presenting a filtered feed with detail views and rolling AI summaries.  
The deployed architecture is AWS Amplify (web), API Gateway + Lambda in VPC (API), and RDS PostgreSQL (data).

## Functional Summary
- Google Workspace sign-in gate (`@zodl.com` by default).
- Optional local-network bypass gate (feature-flagged, kill-switchable, IP allowlist based).
- Dashboard hub (`/`) with X Monitor as the active dashboard.
- X Monitor page (`/x-monitor`) with:
  - feed filters (tier, handle, significant flag, date range, text search, limit),
  - semantic search mode for natural-language retrieval,
  - grounded "Answer mode" (retrieve + synthesize + citations + optional draft),
  - cursor-based pagination,
  - freshness indicator with manual refresh,
  - rolling summary panel (2h + 12h).
- Post detail page (`/posts/{statusId}`) with metrics snapshots and report state.
- Ingest APIs for:
  - posts,
  - metric snapshots,
  - reports,
  - pipeline runs,
  - window summaries,
  - narrative shifts.
- Shared-secret auth on all ingest routes.

## Technical Summary
- Frontend/API framework: Next.js 15 (App Router), React 19, Node.js runtime.
- Auth: NextAuth + Google provider with domain restriction, with optional local bypass based on allowlisted source IP.
- DB access: `pg` pool, direct Postgres queries/upserts.
- Dual API execution modes:
  - local Next.js `/api/v1/*` routes (can query DB directly),
  - proxy mode to hosted backend (`XMONITOR_BACKEND_API_BASE_URL`),
  - dedicated AWS Lambda backend (`services/vpc-api-lambda`) exposing `/v1/*`.
- Data model includes core post metrics plus summary analytics tables:
  - `window_summaries`,
  - `narrative_shifts`.

---

## Current Architecture

### Write Path (collector -> API -> Postgres)
1. Local collector/dispatcher gathers X data (external OpenClaw workspace).
2. Sync client sends idempotent ingest payloads to `/v1/ingest/*`.
3. API validates payloads and upserts by stable keys.
4. PostgreSQL is the source of truth.

### Read Path (browser -> web app -> API/DB)
1. User signs in through Google Workspace, unless local bypass is explicitly enabled and the request source IP matches the bypass allowlist.
2. `/x-monitor` and `/posts/{statusId}` fetch from:
   - `XMONITOR_READ_API_BASE_URL` if set, otherwise
   - direct DB reads if DB env vars are configured.
3. Feed polling checks for new items every 3 minutes and exposes manual refresh.

### Runtime Modes
- `Hosted read mode`:
  - Set `XMONITOR_READ_API_BASE_URL`.
  - UI reads from hosted API.
  - Local DB is not required for read path.
- `Proxy mode for local /api/v1 routes`:
  - Set `XMONITOR_BACKEND_API_BASE_URL`.
  - Local `/api/v1/*` forwards to backend `/v1/*`.
- `Direct DB mode`:
  - Leave read/proxy API base URLs unset.
  - Set `DATABASE_URL` or `PG*`.

---

## Repository Map

- `app/`: Next.js pages and API routes.
- `lib/`: auth, DB wiring, validators, repository logic, API proxy helpers.
- `db/migrations/`: Postgres schema SQL.
- `scripts/db/`: migration runner.
- `scripts/migrate/`: SQLite export/import/validation utilities.
- `scripts/aws/`: backend provisioning script.
- `services/vpc-api-lambda/`: Lambda API implementation (`/v1/*`).
- `docs/`: runbooks, OpenAPI, schema notes, ADRs, migration plans.

---

## Prerequisites

- Node.js `>=22 <23`
- npm
- Python 3.10+
- `psql` (for DB migration script)
- AWS CLI (for deployment/provisioning workflows)

---

## Local Development

### 1) Install dependencies

```bash
npm install
```

### 2) Create env file

```bash
cp .env.example .env.local
```

Set these at minimum:

- `NEXTAUTH_URL=http://localhost:3000`
- `NEXTAUTH_SECRET=<random-secret>`
- `GOOGLE_CLIENT_ID=<google-web-oauth-client-id>`
- `GOOGLE_CLIENT_SECRET=<google-web-oauth-client-secret>`
- `ALLOWED_GOOGLE_DOMAIN=zodl.com`

### 3) Choose data mode

Option A: hosted API read mode (fastest for UI work)

```env
XMONITOR_READ_API_BASE_URL=https://www.zodldashboard.com/api/v1
XMONITOR_BACKEND_API_BASE_URL=
```

Option B: local direct DB mode

```env
XMONITOR_READ_API_BASE_URL=
XMONITOR_BACKEND_API_BASE_URL=
DATABASE_URL=postgres://user:password@localhost:5432/xmonitor
```

Apply schema in local DB mode:

```bash
npm run db:migrate
```

### 4) Run app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

### Web app / Next.js API runtime

| Variable | Required | Description |
|---|---|---|
| `NEXTAUTH_URL` | Yes | Base URL used by NextAuth callbacks. |
| `NEXTAUTH_SECRET` | Yes | Session/JWT signing secret. |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret. |
| `ALLOWED_GOOGLE_DOMAIN` | Yes | Allowed Workspace domain (default `zodl.com`). |
| `LOCAL_BYPASS_ENABLED` | Optional | Enable local-network auth bypass (`false` by default). |
| `LOCAL_BYPASS_KILL_SWITCH` | Optional | Emergency disable for bypass (`false` by default). |
| `LOCAL_BYPASS_DDNS_HOST` | Optional | DDNS host used to resolve current allowlisted egress IPs. |
| `LOCAL_BYPASS_ALLOWLIST_IPS` | Optional | Static comma-separated IP allowlist merged with DDNS-resolved IPs. |
| `LOCAL_BYPASS_REFRESH_SECONDS` | Optional | DDNS refresh interval seconds (default `300`, min `15`). |
| `LOCAL_BYPASS_IP_SOURCE_STRATEGY` | Optional | `strict` (recommended) or `rightmost` for `X-Forwarded-For` parsing. |
| `LOCAL_BYPASS_TRUSTED_PROXY_IPS` | Optional | Trusted proxy hop IPs required by `strict` strategy. |
| `LOCAL_BYPASS_CLIENT_IP_HEADER` | Optional | Trusted infra header containing client IP (overrides XFF parsing). |
| `LOCAL_BYPASS_DISPLAY_EMAIL` | Optional | Identity label shown in UI during bypass sessions. |
| `LOCAL_BYPASS_LOG_DECISIONS` | Optional | Log bypass allow/deny decisions (default `true`). |
| `XMONITOR_READ_API_BASE_URL` | Optional | UI data source base for feed/detail/summary reads. |
| `XMONITOR_BACKEND_API_BASE_URL` | Optional | Proxy target for local `/api/v1/*` routes. |
| `XMONITOR_API_PROXY_TIMEOUT_MS` | Optional | Upstream proxy timeout in ms (default `15000`). |
| `XMONITOR_API_SERVICE_NAME` | Optional | Service name in health response (default `xmonitor-api`). |
| `XMONITOR_API_VERSION` | Optional | API version in health response (default `v1`). |
| `XMONITOR_DEFAULT_FEED_LIMIT` | Optional | Default feed limit (default `50`). |
| `XMONITOR_MAX_FEED_LIMIT` | Optional | Max feed limit clamp (default `200`). |
| `XMONITOR_SEMANTIC_ENABLED` | Optional | Enables semantic retrieval route/mode (default `true`). |
| `XMONITOR_EMBEDDING_BASE_URL` | Optional | Embedding provider base URL for query vectors. |
| `XMONITOR_EMBEDDING_MODEL` | Optional | Embedding model for query vectors (default `text-embedding-bge-m3`). |
| `XMONITOR_EMBEDDING_DIMS` | Optional | Expected embedding dimension (default `1024`). |
| `XMONITOR_EMBEDDING_TIMEOUT_MS` | Optional | Embedding request timeout ms (default `10000`). |
| `XMONITOR_EMBEDDING_API_KEY` | Optional | Preferred embedding API key secret. |
| `VENICE_API_KEY` | Optional | Fallback secret for embedding/compose provider calls. |
| `XMONITOR_COMPOSE_ENABLED` | Optional | Enables compose endpoint/UI panel (default `true`). |
| `XMONITOR_COMPOSE_DRAFTS_ENABLED` | Optional | Allows draft output (`x_post`/`thread`) when compose is enabled. |
| `XMONITOR_COMPOSE_BASE_URL` | Optional | Compose provider base URL (default Venice OpenAI-compatible endpoint). |
| `XMONITOR_COMPOSE_MODEL` | Optional | Text model for grounded answer generation. |
| `XMONITOR_COMPOSE_TIMEOUT_MS` | Optional | Compose model request timeout ms (default `20000`). |
| `XMONITOR_COMPOSE_MAX_OUTPUT_TOKENS` | Optional | Max generated tokens per compose request. |
| `XMONITOR_COMPOSE_MAX_DRAFT_CHARS` | Optional | Max draft length for `thread` output (default `1200`). |
| `XMONITOR_COMPOSE_MAX_DRAFT_CHARS_X_POST` | Optional | Max draft length for `x_post` output (default `280`). |
| `XMONITOR_COMPOSE_MAX_CITATIONS` | Optional | Max citations returned in compose response (default `10`). |
| `XMONITOR_COMPOSE_MAX_REQUESTS_PER_MINUTE` | Optional | In-process rate guard for compose requests. |
| `XMONITOR_COMPOSE_MAX_CONCURRENCY` | Optional | In-process concurrency guard for compose requests. |
| `XMONITOR_COMPOSE_MAX_ESTIMATED_COST_USD` | Optional | Per-request projected cost ceiling guard. |
| `XMONITOR_COMPOSE_INPUT_COST_PER_1M_TOKENS` | Optional | Input token cost basis used for estimate logs/guard. |
| `XMONITOR_COMPOSE_OUTPUT_COST_PER_1M_TOKENS` | Optional | Output token cost basis used for estimate logs/guard. |
| `XMONITOR_COMPOSE_USE_JSON_MODE` | Optional | Try model JSON mode before plain prompt-only parsing fallback. |
| `XMONITOR_COMPOSE_DISABLE_THINKING` | Optional | For Venice thinking models, requests direct answer output (default `true`). |
| `XMONITOR_COMPOSE_STRIP_THINKING_RESPONSE` | Optional | For Venice thinking models, strips reasoning channel from response (default `true`). |
| `XMONITOR_COMPOSE_API_KEY` | Optional | Preferred compose API key secret. |
| `XMONITOR_INGEST_SHARED_SECRET` | Required for ingest | Shared secret for ingest route auth. |
| `XMONITOR_API_KEY` | Optional | Compatibility fallback for ingest secret. |
| `DATABASE_URL` | Optional* | Postgres DSN. |
| `PGHOST` `PGPORT` `PGDATABASE` `PGUSER` `PGPASSWORD` `PGSSLMODE` | Optional* | Split Postgres settings when `DATABASE_URL` is unset. |

\* Required only when reading/writing DB directly from this runtime.

### Lambda provisioning script inputs

`scripts/aws/provision_vpc_api_lambda.sh` supports overrides such as:

- `AWS_PROFILE`
- `AWS_REGION`
- `VPC_ID`
- `RDS_SG_ID`
- `DB_SECRET_ID`
- `INGEST_SHARED_SECRET`
- `LAMBDA_FUNCTION_NAME`
- `API_NAME`
- `SUMMARY_SCHEMA_BOOTSTRAP`
- `SUMMARY_SCHEMA_GRANT_ROLE`

---

## Route Surface

### App pages

- `/signin`
- `/`
- `/x-monitor`
- `/posts/{statusId}`
- `/oauth-probe`

### Utility route

- `GET /api/oauth/probe/start`
- `GET|POST /api/auth/[...nextauth]`

### Next.js API routes (`/api/v1`)

- `GET /api/v1/health`
- `GET /api/v1/feed`
- `POST /api/v1/query/semantic`
- `POST /api/v1/query/compose`
- `GET /api/v1/posts/{statusId}`
- `GET /api/v1/window-summaries/latest`
- `POST /api/v1/ingest/posts/batch`
- `POST /api/v1/ingest/metrics/batch`
- `POST /api/v1/ingest/reports/batch`
- `POST /api/v1/ingest/window-summaries/batch`
- `POST /api/v1/ingest/narrative-shifts/batch`
- `POST /api/v1/ingest/runs`

### Hosted backend routes (`/v1`)

- `GET /v1/health`
- `GET /v1/feed`
- `POST /v1/query/semantic`
- `POST /v1/query/compose` (retrieval evidence stage)
- `GET /v1/posts/{statusId}`
- `GET /v1/window-summaries/latest`
- `POST /v1/ingest/posts/batch`
- `POST /v1/ingest/metrics/batch`
- `POST /v1/ingest/reports/batch`
- `POST /v1/ingest/window-summaries/batch`
- `POST /v1/ingest/narrative-shifts/batch`
- `POST /v1/ingest/runs`

Notes:
- Batch ingest endpoints require `{"items":[...]}` payload shape.
- `/ingest/runs` accepts a single run object (not a batch array).
- Ingest auth accepts either:
  - `x-api-key: <secret>`
  - `Authorization: Bearer <secret>`

---

## Data Model (high level)

Core tables from `001_init.sql`:

- `posts`
- `post_metrics_snapshots`
- `reports`
- `watch_accounts`
- `pipeline_runs`
- `embeddings`

Summary analytics tables from `002_summary_analytics.sql`:

- `window_summaries`
- `narrative_shifts`

---

## NPM Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local Next.js dev server. |
| `npm run build` | Production build. |
| `npm run start` | Start built app. |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`). |
| `npm run db:migrate` | Apply all SQL migrations in `db/migrations/`. |
| `npm run migrate:export` | Export SQLite tables to JSONL. |
| `npm run migrate:import` | Import JSONL into Postgres with idempotent upserts. |
| `npm run migrate:validate` | Compare SQLite and Postgres counts + spot checks. |

---

## DB Migration Workflow (SQLite -> Postgres)

### 1) Export SQLite to JSONL

```bash
python3 scripts/migrate/export_sqlite.py \
  --sqlite-path /Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db \
  --out-dir data/export
```

### 2) Import JSONL to Postgres

```bash
DATABASE_URL='postgres://user:pass@host:5432/xmonitor' \
python3 scripts/migrate/import_sqlite_jsonl_to_postgres.py \
  --input-dir data/export \
  --reject-log data/import_rejects.ndjson
```

### 3) Validate migration parity

```bash
DATABASE_URL='postgres://user:pass@host:5432/xmonitor' \
python3 scripts/migrate/validate_counts.py \
  --sqlite-path data/x_monitor.snapshot.db
```

---

## AWS Deployment and Operations

### Amplify release

```bash
aws --profile zodldashboard --region us-east-1 amplify start-job \
  --app-id d2rgmein7vsf2e \
  --branch-name main \
  --job-type RELEASE
```

### Provision or update VPC Lambda API

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
./scripts/aws/provision_vpc_api_lambda.sh
```

### Smoke checks

```bash
curl -sS 'https://www.zodldashboard.com/api/v1/health'
curl -sS 'https://www.zodldashboard.com/api/v1/feed?limit=3'
curl -sS 'https://www.zodldashboard.com/api/v1/window-summaries/latest'
```

Ingest auth check (expected `401` without key):

```bash
BACKEND_API_BASE='https://<api-id>.execute-api.us-east-1.amazonaws.com/v1'
curl -i -X POST "$BACKEND_API_BASE/ingest/runs" \
  -H 'content-type: application/json' \
  --data '{"run_at":"2026-02-23T00:00:00Z","mode":"manual"}'
```

---

## Troubleshooting

### Google sign-in fails

- Verify `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL`.
- Verify OAuth callback URL matches your active host.
- Verify account is in allowed domain and email is verified.
- Use `/oauth-probe` to isolate Workspace policy blocks.

### Local bypass does not trigger

- Confirm `LOCAL_BYPASS_ENABLED=true` and `LOCAL_BYPASS_KILL_SWITCH=false`.
- Confirm allowlist is non-empty (`LOCAL_BYPASS_DDNS_HOST` and/or `LOCAL_BYPASS_ALLOWLIST_IPS`).
- If using `LOCAL_BYPASS_IP_SOURCE_STRATEGY=strict`, set `LOCAL_BYPASS_TRUSTED_PROXY_IPS` to trusted proxy hops.
- If your platform provides a verified client IP header, set `LOCAL_BYPASS_CLIENT_IP_HEADER` (for example `cloudfront-viewer-address`).
- Check server logs for `[auth][local-bypass]` allow/deny entries.

### Feed/detail/summaries do not load

Set one valid backend mode:

- `XMONITOR_READ_API_BASE_URL`, or
- direct DB config (`DATABASE_URL` or `PG*`).

### Ingest returns `401 unauthorized`

- Ensure caller sends `x-api-key` or Bearer token.
- Ensure runtime secret is set (`XMONITOR_INGEST_SHARED_SECRET` or fallback `XMONITOR_API_KEY`).

### Local `/api/v1/*` proxy issues

- Set `XMONITOR_BACKEND_API_BASE_URL`.
- Confirm the target host serves `GET /v1/health` successfully.
- Verify `XMONITOR_API_PROXY_TIMEOUT_MS` is sufficient for your network path.

### DB connection issues

- Validate `DATABASE_URL` or `PGHOST/PGDATABASE/PGUSER`.
- Check `PGSSLMODE` against target DB requirements.
- Re-run `npm run db:migrate` after pointing at a new DB.

---

## Documentation Index

- `docs/AWS_MIGRATION_RUNBOOK.md`
- `docs/POSTGRES_SCHEMA_AND_OPENAPI_V1.md`
- `docs/openapi.v1.yaml`
- `docs/ADR-0001-postgres-over-dynamodb.md`
- `docs/DIRECT_INGEST_API_TRANSITION_PLAN.md`
- `docs/X_MONITOR_X_QUERY_AND_WATCHLIST_REFERENCE.md`
- `docs/OPENCLAW_NL_QUERY_PARITY_IMPLEMENTATION_PLAN.md`

---

## Security Notes

- Never commit live secrets to git.
- Keep OAuth credentials and ingest secret in secure runtime config.
- Rotate secrets immediately if they are exposed.
- Restrict DB network access to trusted AWS resources (for example VPC Lambda SG to RDS SG).
- Keep local bypass disabled by default and use the kill switch during incidents.
- Prefer `strict` client-IP strategy with explicit trusted proxy hops.
- Treat `rightmost` strategy as less strict and only use it when infrastructure behavior is fully understood.
