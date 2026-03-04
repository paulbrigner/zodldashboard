# ZODL Dashboard (X Monitor + Regulatory Risk)

## Executive Summary
ZODL Dashboard is an authenticated web app and API for monitoring selected X posts, storing them in PostgreSQL, and presenting a filtered feed with detail views and rolling AI summaries.
Production ingestion now runs server-side on AWS using scheduled X API collector Lambdas (priority + discovery), with PostgreSQL as the only system of record.

## Functional Summary
- Google Workspace sign-in gate (`@zodl.com` by default).
- Optional local-network bypass gate (feature-flagged, kill-switchable, IP allowlist based).
- Dashboard hub (`/`) with:
  - X Monitor (`/x-monitor`)
  - Regulatory Risk by Geography (`/regulatory-risk`)
- X Monitor page (`/x-monitor`) with:
  - semantic search mode as the default filter mode for natural-language retrieval,
  - keyword filter mode (tier, handle, significant flag, date range, text search, limit),
  - grounded "Answer mode" (retrieve + synthesize + citations + optional `x_post`/`thread`/`email` drafts),
  - email send + per-user scheduled email jobs from Answer Mode (OAuth users),
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
- Auth: NextAuth with primary Google Workspace domain restriction, optional guest Google provider (email allowlist), plus optional local bypass based on allowlisted source IP.
- DB access: `pg` pool, direct Postgres queries/upserts.
- Dual API execution modes:
  - local Next.js `/api/v1/*` routes (can query DB directly),
  - proxy mode to hosted backend (`XMONITOR_BACKEND_API_BASE_URL`),
  - dedicated AWS Lambda backend (`services/vpc-api-lambda`) exposing `/v1/*`.
- Ingestion runtime:
  - `services/x-api-collector-lambda` runs as scheduled AWS Lambda collectors,
  - EventBridge schedules priority (15m) and discovery (60m) runs,
  - collectors call X API, score/filter posts, ingest posts/embeddings/runs, and generate rolling summaries in discovery mode.
- Email runtime:
  - `services/vpc-api-lambda` exposes email send + schedule APIs,
  - SES sends outbound email,
  - EventBridge + scheduler Lambda enqueue due scheduled email runs to SQS,
  - worker Lambda executes scheduled runs and persists delivery audit rows.
- Data model includes core post metrics plus summary analytics tables:
  - `window_summaries`,
  - `narrative_shifts`.

---

## Current Architecture

### Write Path (collector -> API -> Postgres)
1. EventBridge triggers AWS collector Lambdas:
   - `xmonitor-xapi-priority-collector` (priority + watchlist replies),
   - `xmonitor-xapi-discovery-collector` (discovery + rolling summaries).
2. Collector calls X API search endpoints, normalizes records, applies language/noise/omit/significance gates, and computes embeddings.
3. Collector sends idempotent ingest payloads to hosted `/api/v1/ingest/*` endpoints.
4. API proxy routes to backend `/v1/*`, Lambda validates payloads, and Postgres upserts by stable keys.
5. PostgreSQL is the source of truth.

Local OpenClaw/launchd collection is now fallback-only and not part of the normal production write path.

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
- `scripts/aws/`: AWS provisioning scripts for backend and collectors.
- `scripts/ops/`: operational utilities (for example omit-list + purge helper).
- `services/vpc-api-lambda/`: Lambda API implementation (`/v1/*`).
- `services/x-api-collector-lambda/`: scheduled X API collector implementation (`priority`/`discovery`).
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

Optional guest provider (separate Google OAuth client):

- `GUEST_GOOGLE_OAUTH_ENABLED=true`
- `GOOGLE_GUEST_CLIENT_ID=<guest-google-web-oauth-client-id>`
- `GOOGLE_GUEST_CLIENT_SECRET=<guest-google-web-oauth-client-secret>`
- `ALLOWED_GUEST_GOOGLE_EMAILS=guest1@example.com,guest2@example.com`

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
| `GUEST_GOOGLE_OAUTH_ENABLED` | Optional | Enables secondary Google guest provider (`false` by default). |
| `GOOGLE_GUEST_CLIENT_ID` | Optional | OAuth client ID for guest provider (required when guest provider enabled). |
| `GOOGLE_GUEST_CLIENT_SECRET` | Optional | OAuth client secret for guest provider (required when guest provider enabled). |
| `ALLOWED_GUEST_GOOGLE_EMAILS` | Optional | Exact comma/space-separated email allowlist for guest provider sign-in. |
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
| `REGULATORY_RISK_DATA_URL` | Optional | Runtime URL override for regulatory-risk `data_bundle_v1_1.json` (falls back to bundled data when unavailable). |
| `DATA_URL` | Optional | Generic runtime data URL fallback used by regulatory-risk when `REGULATORY_RISK_DATA_URL` is unset. |
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
| `XMONITOR_COMPOSE_DRAFTS_ENABLED` | Optional | Allows draft output (`x_post`/`thread`/`email`) when compose is enabled. |
| `XMONITOR_COMPOSE_BASE_URL` | Optional | Compose provider base URL (default Venice OpenAI-compatible endpoint). |
| `XMONITOR_COMPOSE_MODEL` | Optional | Text model for grounded answer generation. |
| `XMONITOR_COMPOSE_TIMEOUT_MS` | Optional | Compose model request timeout ms (`120000` is recommended for high-quality async mode). |
| `XMONITOR_COMPOSE_MAX_OUTPUT_TOKENS` | Optional | Explicit max generated tokens cap; leave unset/empty to omit `max_tokens` and let provider defaults apply. |
| `XMONITOR_COMPOSE_MAX_DRAFT_CHARS` | Optional | Max draft length for `thread` output (default `1200`). |
| `XMONITOR_COMPOSE_MAX_DRAFT_CHARS_X_POST` | Optional | Max draft length for `x_post` output (default `280`). |
| `XMONITOR_COMPOSE_MAX_CITATIONS` | Optional | Max citations returned in compose response (default `10`). |
| `XMONITOR_COMPOSE_ASYNC_ENABLED` | Optional | Enables async compose jobs (`/query/compose/jobs`) and worker-driven synthesis. |
| `XMONITOR_COMPOSE_JOBS_QUEUE_URL` | Required for async mode | SQS queue URL used for compose job dispatch/retry. |
| `XMONITOR_COMPOSE_JOB_POLL_MS` | Optional | Suggested polling interval for compose job checks (default `2500`). |
| `XMONITOR_COMPOSE_JOB_TTL_HOURS` | Optional | Job expiry horizon in hours (default `24`). |
| `XMONITOR_COMPOSE_JOB_MAX_ATTEMPTS` | Optional | Worker retry ceiling before terminal failure (default `3`). |
| `XMONITOR_ENABLE_COMPOSE_JOBS_SCHEMA_BOOTSTRAP` | Optional | Auto-creates `compose_jobs` schema objects in backend Lambda (default `false`, recommended for least-privilege app DB roles). |
| `XMONITOR_COMPOSE_MAX_REQUESTS_PER_MINUTE` | Optional | In-process rate guard for compose requests. |
| `XMONITOR_COMPOSE_MAX_CONCURRENCY` | Optional | In-process concurrency guard for compose requests. |
| `XMONITOR_COMPOSE_MAX_ESTIMATED_COST_USD` | Optional | Per-request projected cost ceiling guard. |
| `XMONITOR_COMPOSE_INPUT_COST_PER_1M_TOKENS` | Optional | Input token cost basis used for estimate logs/guard. |
| `XMONITOR_COMPOSE_OUTPUT_COST_PER_1M_TOKENS` | Optional | Output token cost basis used for estimate logs/guard. |
| `XMONITOR_COMPOSE_USE_JSON_MODE` | Optional | Try model JSON mode before plain prompt-only parsing fallback. |
| `XMONITOR_COMPOSE_DISABLE_THINKING` | Optional | For Venice thinking models, requests direct answer output (default `true`). |
| `XMONITOR_COMPOSE_STRIP_THINKING_RESPONSE` | Optional | For Venice thinking models, strips reasoning channel from response (default `true`). |
| `XMONITOR_COMPOSE_API_KEY` | Optional | Preferred compose API key secret. |
| `XMONITOR_USER_PROXY_SECRET` | Required for email features | Shared secret used by Next proxy routes when forwarding authenticated user context to backend `/v1/email/*`. |
| `XMONITOR_EMAIL_ENABLED` | Optional | Enables email draft send endpoints and UI controls (default `false`). |
| `XMONITOR_EMAIL_SCHEDULES_ENABLED` | Optional | Enables scheduled email job APIs and UI controls (default `false`). |
| `XMONITOR_EMAIL_REQUIRE_OAUTH` | Optional | Requires OAuth sessions (not local bypass) for email actions (default `true`). |
| `XMONITOR_EMAIL_FROM_ADDRESS` | Required for email send | SES verified sender address used for outbound mail. |
| `XMONITOR_EMAIL_FROM_NAME` | Optional | Display name paired with sender address (default `ZodlDashboard X Monitor`). |
| `XMONITOR_EMAIL_MAX_RECIPIENTS` | Optional | Max recipients per send/job (default `10`). |
| `XMONITOR_EMAIL_MAX_JOBS_PER_USER` | Optional | Max scheduled jobs per owner email (default `25`). |
| `XMONITOR_EMAIL_MAX_BODY_CHARS` | Optional | Max stored/sent body length for markdown/text fields (default `20000`). |
| `XMONITOR_EMAIL_SCHEDULE_DISPATCH_LIMIT` | Optional | Max due jobs scanned per scheduler tick (default `25`). |
| `XMONITOR_ENABLE_EMAIL_SCHEMA_BOOTSTRAP` | Optional | Auto-creates scheduled-email schema objects in backend Lambda (default `false`; set `true` when DB migrations cannot be run directly from ops host). |
| `XMONITOR_INGEST_SHARED_SECRET` | Required for ingest | Shared secret for ingest route auth. |
| `XMONITOR_INGEST_OMIT_HANDLES` | Optional | Comma/space-separated author handles to skip for keyword-origin ingest only (watchlist-tier posts are preserved; defaults include `zec_88, zec__2, spaljeni_zec, juan_sanchez13, zeki82086538826, sucveceza_35, windymint1, usa_trader06, roger_welch1, cmscanner_bb, cmscanner_rsi, dexportal_, luckyvinod16, zecigr, disruqtion, zec8, cmscanner_sma, zeczinka, cryptodiane, sureblessing36, pafoslive1, sachin22049721, lovegds1lady, micheal_crypto0, ruth13900929210, michell82710798, kimberl97730856, fx220000, exnesst80805, sfurures_expart, felix__steven, vectorthehunter, forex47kin51201, bullbearcrypt, blacker6636, devendr34011988, dannym4u, scapenerhurst, duncannbaldwin, robertethan_, jamesharri45923, jxttreasury, dannnym4u, rinshad31142287, sumitso40959179, _zonecrypto_, promoimpulse, rmelian_ok, xol1641557, mw_intern, desota, ma1973sk`). |
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
- `INGEST_OMIT_HANDLES`
- `LAMBDA_FUNCTION_NAME`
- `COMPOSE_WORKER_FUNCTION_NAME`
- `EMAIL_SCHEDULER_FUNCTION_NAME`
- `EMAIL_SCHEDULER_TIMEOUT`
- `EMAIL_SCHEDULER_MEMORY_MB`
- `EMAIL_SCHEDULER_RULE_NAME`
- `EMAIL_SCHEDULER_EXPRESSION`
- `API_NAME`
- `COMPOSE_JOBS_QUEUE_NAME`
- `COMPOSE_JOBS_DLQ_NAME`
- `COMPOSE_JOBS_SCHEMA_BOOTSTRAP`
- `COMPOSE_ASYNC_ENABLED`
- `COMPOSE_JOB_POLL_MS`
- `COMPOSE_JOB_TTL_HOURS`
- `COMPOSE_JOB_MAX_ATTEMPTS`
- `COMPOSE_BASE_URL`
- `COMPOSE_MODEL`
- `COMPOSE_TIMEOUT_MS`
- `COMPOSE_MAX_OUTPUT_TOKENS`
- `COMPOSE_API_KEY`
- `EMAIL_ENABLED`
- `EMAIL_SCHEDULES_ENABLED`
- `EMAIL_REQUIRE_OAUTH`
- `EMAIL_FROM_ADDRESS`
- `EMAIL_FROM_NAME`
- `EMAIL_MAX_RECIPIENTS`
- `EMAIL_MAX_JOBS_PER_USER`
- `EMAIL_MAX_BODY_CHARS`
- `EMAIL_SCHEDULE_DISPATCH_LIMIT`
- `USER_PROXY_SECRET`
- `SUMMARY_SCHEMA_BOOTSTRAP`
- `SUMMARY_SCHEMA_GRANT_ROLE`
- `ENABLE_NAT_EGRESS`
- `NAT_PUBLIC_SUBNET_ID`
- `NAT_EIP_ALLOCATION_ID`
- `NAT_GATEWAY_NAME`
- `LAMBDA_PRIVATE_ROUTE_TABLE_NAME`

`scripts/aws/provision_x_api_collector_lambda.sh` supports overrides such as:

- `AWS_PROFILE`
- `AWS_REGION`
- `LAMBDA_FUNCTION_NAME`
- `LAMBDA_ROLE_NAME`
- `EVENT_RULE_NAME`
- `SCHEDULE_EXPRESSION`
- `SCHEDULE_ENABLED`
- `DB_SECRET_ID`
- `INGEST_API_BASE_URL`
- `INGEST_API_KEY`
- `X_API_BEARER_TOKEN`
- `X_API_CONSUMER_KEY`
- `X_API_CONSUMER_SECRET`
- `X_API_REFRESH_BEARER_FROM_CONSUMER`
- `X_API_BASE_URL`
- `X_API_BASE_TERMS`
- `X_API_MAX_RESULTS_PER_QUERY`
- `X_API_MAX_PAGES_PER_QUERY`
- `X_API_HANDLE_CHUNK_SIZE`
- `X_API_REPLY_CAPTURE_ENABLED`
- `X_API_REPLY_MODE`
- `X_API_REPLY_TIERS`
- `X_API_REPLY_SELECTED_HANDLES`
- `X_API_ENFORCE_LANG_ALLOWLIST`
- `X_API_LANG_ALLOWLIST`
- `X_API_EXCLUDE_RETWEETS`
- `X_API_EXCLUDE_QUOTES`
- `EMBEDDING_ENABLED`
- `EMBEDDING_BASE_URL`
- `EMBEDDING_MODEL`
- `EMBEDDING_DIMS`
- `EMBEDDING_TIMEOUT_MS`
- `EMBEDDING_API_KEY`
- `EMBEDDING_BATCH_SIZE`
- `EMBEDDING_MAX_ITEMS_PER_RUN`
- `EMBEDDING_INCLUDE_UPDATED`
- `EMBEDDING_FALLBACK_ALL_IF_NO_IDS`
- `COLLECTOR_ENABLED`
- `COLLECTOR_WRITE_ENABLED`
- `COLLECTOR_DRY_RUN`
- `COLLECTOR_MODE` (`priority|discovery`)
- `XMONITOR_INGEST_OMIT_HANDLES`
- `SUMMARY_ENABLED`
- `SUMMARY_ALIGN_HOURS`
- `SUMMARY_TOP_POSTS_2H`
- `SUMMARY_TOP_POSTS_12H`
- `SUMMARY_FEED_PAGE_LIMIT`
- `SUMMARY_FEED_MAX_ITEMS_PER_WINDOW`
- `SUMMARY_LLM_BACKEND`
- `SUMMARY_LLM_URL`
- `SUMMARY_LLM_MODEL`
- `SUMMARY_LLM_API_KEY`
- `SUMMARY_LLM_TEMPERATURE`
- `SUMMARY_LLM_MAX_TOKENS`
- `SUMMARY_LLM_TIMEOUT_MS`
- `SUMMARY_LLM_MAX_ATTEMPTS`
- `SUMMARY_LLM_INITIAL_BACKOFF_MS`
- `WATCHLIST_TIERS_JSON`
- `WATCHLIST_INCLUDE_HANDLES`

---

## Route Surface

### App pages

- `/signin`
- `/`
- `/x-monitor`
- `/regulatory-risk`
- `/regulatory-risk/jurisdictions`
- `/regulatory-risk/features`
- `/regulatory-risk/policy`
- `/regulatory-risk/activity`
- `/posts/{statusId}`
- `/oauth-probe`

### Utility route

- `GET /api/oauth/probe/start`
- `GET|POST /api/auth/[...nextauth]`

### Next.js API routes (`/api/v1`)

- `GET /api/v1/health`
- `GET /api/v1/feed`
- `POST /api/v1/query/semantic`
- `POST /api/v1/query/compose` (legacy sync flow; still available for fallback)
- `POST /api/v1/query/compose/jobs` (enqueue async grounded answer job)
- `GET /api/v1/query/compose/jobs/{jobId}` (poll async grounded answer job)
- `POST /api/v1/email/send`
- `GET /api/v1/email/schedules`
- `POST /api/v1/email/schedules`
- `PATCH /api/v1/email/schedules/{jobId}`
- `DELETE /api/v1/email/schedules/{jobId}`
- `POST /api/v1/email/schedules/{jobId}/run-now`
- `GET /api/v1/posts/{statusId}`
- `GET /api/v1/window-summaries/latest`
- `GET /api/v1/ops/reconcile-counts`
- `POST /api/v1/ops/purge-handle`
- `POST /api/v1/ingest/posts/batch`
- `POST /api/v1/ingest/metrics/batch`
- `POST /api/v1/ingest/reports/batch`
- `POST /api/v1/ingest/window-summaries/batch`
- `POST /api/v1/ingest/narrative-shifts/batch`
- `POST /api/v1/ingest/embeddings/batch`
- `POST /api/v1/ingest/runs`

### Hosted backend routes (`/v1`)

- `GET /v1/health`
- `GET /v1/feed`
- `POST /v1/query/semantic`
- `POST /v1/query/compose` (retrieval/evidence stage only; no text generation)
- `POST /v1/query/compose/jobs` (create async grounded answer job)
- `GET /v1/query/compose/jobs/{jobId}` (job status + terminal result/error)
- `POST /v1/email/send`
- `GET /v1/email/schedules`
- `POST /v1/email/schedules`
- `PATCH /v1/email/schedules/{jobId}`
- `DELETE /v1/email/schedules/{jobId}`
- `POST /v1/email/schedules/{jobId}/run-now`
- `GET /v1/posts/{statusId}`
- `GET /v1/window-summaries/latest`
- `GET /v1/ops/reconcile-counts`
- `POST /v1/ops/purge-handle`
- `POST /v1/ingest/posts/batch`
- `POST /v1/ingest/metrics/batch`
- `POST /v1/ingest/reports/batch`
- `POST /v1/ingest/window-summaries/batch`
- `POST /v1/ingest/narrative-shifts/batch`
- `POST /v1/ingest/embeddings/batch`
- `POST /v1/ingest/runs`

Notes:
- Batch ingest endpoints require `{"items":[...]}` payload shape.
- `/ingest/runs` accepts a single run object (not a batch array).
- Ingest auth accepts either:
  - `x-api-key: <secret>`
  - `Authorization: Bearer <secret>`
- Ops routes (`/ops/*`) use the same shared-secret auth as ingest routes.

---

## Search and Answer Modes

### Keyword search mode

- Secondary mode in the Filters panel (semantic is the default mode).
- Uses `GET /api/v1/feed` (or `GET /v1/feed` when called directly).
- Exposes tier, handle, significant, date range, lexical text search, and limit.
- Supports cursor pagination and feed freshness polling.

### Semantic search mode

- Natural-language retrieval mode powered by embeddings (`text-embedding-bge-m3` by default).
- UI intentionally simplifies controls to one larger "Semantic prompt" field plus a built-in example prompt.
- Uses `POST /api/v1/query/semantic` (proxying to `POST /v1/query/semantic`).
- API supports optional scope filters (`since`, `until`, `tier`, `handle`, `significant`, `limit`) even when not shown in the simplified semantic UI.
- Returns ranked feed items with `score`, plus retrieval metadata (`model`, `retrieved_count`).

### Answer Mode (grounded RAG)

- Collapsed by default under "Answer Mode" on `/x-monitor`.
- Uses async job execution with polling:
  1. UI submits request to `POST /api/v1/query/compose/jobs` (proxy to `POST /v1/query/compose/jobs`).
  2. Backend enqueues SQS job and returns `job_id` quickly (`202`).
  3. UI polls `GET /api/v1/query/compose/jobs/{jobId}` until terminal status.
  4. Worker performs retrieval + synthesis and persists final result/error in `compose_jobs`.
- Inputs:
  - `task_text` (required),
  - scope filters (`since`, `until`, `tier`, `handle`, `significant`),
  - `retrieval_limit` (bounded to `1..100`),
  - `context_limit` (bounded to `1..24`, and never above retrieval limit),
  - `answer_style` (`brief|balanced|detailed`),
  - `draft_format` (`none|x_post|thread|email`).
- Output is structured and citation-backed:
  - `answer_text`,
  - optional `draft_text`,
  - optional `email_draft` (`subject`, `body_markdown`, optional `body_text`),
  - `key_points[]`,
  - `citations[]` (`status_id`, `url`, `author_handle`, excerpt, score),
  - `retrieval_stats` (`retrieved_count`, `used_count`, `model`, `latency_ms`, optional `coverage_score`).
- `answer_text` and `draft_text` are generated as Markdown and rendered in the UI as formatted content (not raw Markdown syntax).
- Job states: `queued`, `running`, `succeeded`, `failed`, `expired`.
- If synthesis output is malformed, parser-safe fallback still returns retrieval-backed evidence/citations.
- With `draft_format=email`:
  - user can edit and send email immediately via SES,
  - user can create per-user scheduled email jobs (create/edit/enable/disable/run-now/delete).

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

Async compose job table from `004_compose_jobs.sql`:

- `compose_jobs`

Email delivery + scheduling tables from `005_email_schedules_and_deliveries.sql`:

- `scheduled_email_jobs`
- `scheduled_email_runs`
- `email_deliveries`

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

## DB Migration Workflow (SQLite -> Postgres, historical/one-time)

These utilities are retained for auditability and emergency re-syncs. They are not part of normal production ingestion.

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

### Provision or update X API collector Lambda (priority + watchlist replies)

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
X_API_BEARER_TOKEN='<x-api-bearer-token>' \
./scripts/aws/provision_x_api_collector_lambda.sh
```

### Provision or update X API collector Lambda (discovery)

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
X_API_BEARER_TOKEN='<x-api-bearer-token>' \
./scripts/aws/provision_x_api_discovery_collector_lambda.sh
```

Notes:
- Discovery Lambda now generates and ingests `rolling_2h` and `rolling_12h` window summaries on aligned intervals (default every 2 hours in UTC).
- Summary generation uses AI narrative output when available, with automatic fallback to stats-style summary text.
- Email scheduling uses:
  - scheduler Lambda `xmonitor-vpc-email-scheduler` (`index.schedulerHandler`),
  - EventBridge rule `xmonitor-email-schedule-dispatch` (default `rate(5 minutes)`),
  - worker Lambda `xmonitor-vpc-compose-worker` processing scheduled email run messages from the compose queue.

Collector operations:
- Keep `xmonitor-xapi-priority-collector-15m` and `xmonitor-xapi-discovery-collector-60m` enabled for normal production ingestion.
- For temporary dry-runs, set `COLLECTOR_WRITE_ENABLED=false` before reprovisioning a collector.
- To stop ingest quickly, disable the two EventBridge rules above.
- Local launchd collectors are fallback-only and should remain disabled unless you are explicitly rolling back.

### Smoke checks

```bash
curl -sS 'https://www.zodldashboard.com/api/v1/health'
curl -sS 'https://www.zodldashboard.com/api/v1/feed?limit=3'
curl -sS 'https://www.zodldashboard.com/api/v1/window-summaries/latest'
```

### Add omit handles + purge existing rows (remote first, local optional)

```bash
python3 scripts/ops/omit_and_purge_handles.py @handle_one @handle_two
```

Notes:
- Handles can be space-separated or comma-separated, with or without `@`.
- Script updates omit defaults in server-side repo files (and legacy local files when present).
- Script purges matching rows from remote API (`/v1/ops/purge-handle`) and local SQLite when available.
- Script only pauses/resumes local launchd jobs if those plists/runtime paths exist.
- For remote purge auth it uses `--api-key`, then `XMONITOR_API_KEY`, then `launchctl getenv XMONITOR_API_KEY`.
- Add `--update-lambda-env --aws-profile zodldashboard --aws-region us-east-1` to also update live Lambda env var `XMONITOR_INGEST_OMIT_HANDLES`.

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
- Verify OAuth callback URL matches your active host (`/api/auth/callback/google` for internal provider and `/api/auth/callback/google-guest` for guest provider).
- Verify account email is verified.
- For internal provider, verify account is in `ALLOWED_GOOGLE_DOMAIN`.
- For guest provider, verify `GUEST_GOOGLE_OAUTH_ENABLED=true`, guest client credentials are set, and email appears in `ALLOWED_GUEST_GOOGLE_EMAILS`.
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

### Semantic mode returns errors or empty results

- Confirm `XMONITOR_SEMANTIC_ENABLED=true`.
- Confirm embedding credentials are present (`XMONITOR_EMBEDDING_API_KEY` or `VENICE_API_KEY`).
- Confirm the corpus has embeddings for current posts (`embeddings` table populated with matching `model`/`dims`).
- Confirm `XMONITOR_BACKEND_API_BASE_URL` is set for `/api/v1/query/semantic`.

### Answer Mode falls back with "AI synthesis is temporarily unavailable"

- Confirm `XMONITOR_COMPOSE_ENABLED=true`, `XMONITOR_COMPOSE_ASYNC_ENABLED=true`, and `XMONITOR_COMPOSE_JOBS_QUEUE_URL` are set in backend Lambda env.
- Confirm compose model credentials are present (`XMONITOR_COMPOSE_API_KEY` or fallback key).
- Confirm worker Lambda is deployed and has active SQS event-source mapping.
- If worker/API Lambdas are VPC-attached, ensure internet egress exists for model API calls (NAT route for Lambda subnets or equivalent egress path).
- Increase `XMONITOR_COMPOSE_TIMEOUT_MS` and/or reduce UI `Retrieval limit` + `Context limit` if jobs frequently fail.
- Check logs for `compose_job_queued`, `compose_job_requeued`, `compose_job_failed`, and `compose_query_fallback_backend`.

### Answer Mode returns `Request failed (504)`

- This usually means a sync timeout boundary was hit on an older path.
- Confirm UI is using async endpoints (`/api/v1/query/compose/jobs` + polling).
- Confirm backend async mode is enabled and queue/worker are healthy.
- For very large prompts and high limits, keep `XMONITOR_COMPOSE_TIMEOUT_MS` high (for example `120000`) and avoid excessive context.

### Email send or schedule actions fail

- Confirm `XMONITOR_EMAIL_ENABLED=true` and (for schedules) `XMONITOR_EMAIL_SCHEDULES_ENABLED=true`.
- Confirm `XMONITOR_USER_PROXY_SECRET` matches on web runtime and backend Lambda runtime.
- Confirm SES sender identity is verified for `XMONITOR_EMAIL_FROM_ADDRESS`.
- Confirm backend Lambda IAM role allows `ses:SendEmail`.
- For OAuth-only mode (`XMONITOR_EMAIL_REQUIRE_OAUTH=true`), verify user is signed in via OAuth (not local bypass).
- Confirm scheduler Lambda and EventBridge rule are deployed/enabled for recurring sends.

### Rolling summaries show stats-style fallback instead of narrative text

- This means the summary producer likely fell back to legacy/statistical text for that run.
- Verify latest rows in `window_summaries` and inspect `source_version`:

```sql
SELECT window_type, generated_at, source_version
FROM window_summaries
ORDER BY generated_at DESC
LIMIT 20;
```

- Expected narrative rows use `source_version='v2_narrative'`.
- If rows are `v1`, check summary-generation model availability/timeouts on the collector side and rerun summary ingestion.

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

Current architecture and operations:
- `docs/AWS_MIGRATION_RUNBOOK.md`
- `docs/X_MONITOR_X_QUERY_AND_WATCHLIST_REFERENCE.md`
- `docs/X_MONITOR_CAPTURE_PIPELINE_AND_TUNING.md`
- `docs/EMAIL_DRAFT_AND_SCHEDULE_ARCHITECTURE.md`
- `docs/POSTGRES_SCHEMA_AND_OPENAPI_V1.md`
- `docs/openapi.v1.yaml`

Historical planning/execution artifacts:
- `docs/X_API_LAMBDA_PRIORITY_CAPTURE_EXECUTION_PLAN.md`
- `docs/DIRECT_INGEST_API_TRANSITION_PLAN.md`
- `docs/DIRECT_INGEST_EXECUTION_CHECKLIST.md`
- `docs/DIRECT_INGEST_EXECUTION_REPORT_2026-02-25.md`
- `docs/DIRECT_INGEST_GUARDRAILS_EXECUTION_PLAN.md`
- `docs/OPENCLAW_NL_QUERY_PARITY_IMPLEMENTATION_PLAN.md`
- `docs/NL_STAGE1_SEMANTIC_EXECUTION_PLAN.md`
- `docs/NL_STAGE2_SEMANTIC_AI_ANSWER_EXECUTION_PLAN.md`
- `docs/ADR-0001-postgres-over-dynamodb.md`

---

## Security Notes

- Never commit live secrets to git.
- Keep OAuth credentials and ingest secret in secure runtime config.
- Keep `XMONITOR_USER_PROXY_SECRET` secret and rotate if exposed.
- Rotate secrets immediately if they are exposed.
- Restrict DB network access to trusted AWS resources (for example VPC Lambda SG to RDS SG).
- Keep local bypass disabled by default and use the kill switch during incidents.
- Prefer `strict` client-IP strategy with explicit trusted proxy hops.
- Treat `rightmost` strategy as less strict and only use it when infrastructure behavior is fully understood.
