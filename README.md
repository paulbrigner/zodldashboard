# ZODL Dashboard

## About
ZODL Dashboard is an authenticated web app and API for:

- monitoring selected X posts,
- generating grounded AI answers with citations,
- tracking regulatory risk, and
- managing app-store compliance and submission workflows.

Production ingestion runs on AWS with scheduled X API collectors and PostgreSQL as the system of record.

## Current Product Surface

- Google Workspace sign-in (`@zodl.com` by default), with optional guest OAuth and optional local-network bypass.
- Dashboard hub with:
  - X Monitor at `/x-monitor`
  - Regulatory Risk at `/regulatory-risk`
  - App Stores workflows at `/app-stores`
  - CipherPay Test at `/cipherpay-test`
- X Monitor features:
  - keyword search as the default mode,
  - semantic search,
  - filtered feed and post detail views,
  - conversation trends,
  - rolling 2-hour and 12-hour summaries,
  - grounded Answer Mode with citations and draft outputs (`x_post`, `thread`, `email`),
  - email send and scheduled email jobs.

## Architecture

### Write path

1. EventBridge triggers the AWS collector Lambdas.
2. Collectors call the X API, normalize posts, apply capture gates, and compute embeddings.
3. Collectors ingest posts, embeddings, run telemetry, and rolling summaries into the backend API.
4. A separate async classifier assigns significance after ingest.
5. PostgreSQL persists the resulting records.

### Read path

1. Authenticated users access the Next.js app.
2. The app reads from either:
   - hosted API mode via `XMONITOR_READ_API_BASE_URL`, or
   - direct DB mode via `DATABASE_URL` / `PG*`.
3. Local `/api/v1/*` routes can proxy to the hosted backend via `XMONITOR_BACKEND_API_BASE_URL`.

### Main services

- [app](app): Next.js pages and API routes
- [lib](lib): auth, DB access, query/repository logic, helpers
- [services/vpc-api-lambda](services/vpc-api-lambda): hosted `/v1/*` backend
- [services/x-api-collector-lambda](services/x-api-collector-lambda): scheduled X API collectors
- [db/migrations](db/migrations): Postgres schema migrations
- [docs](docs): current architecture, runbooks, and API/schema notes

## Core Data

Primary tables currently used by the live system:

- `posts`
- `watch_accounts`
- `pipeline_runs`
- `embeddings`
- `window_summaries`
- `compose_jobs`
- `scheduled_email_jobs`
- `scheduled_email_runs`
- `email_deliveries`
- `auth_login_events`

## Local Development

### Prerequisites

- Node.js `>=22 <23`
- npm
- Python 3.10+
- `psql`
- AWS CLI for deploy/provisioning workflows

### Install

```bash
npm install
cp .env.example .env.local
```

### Minimum env

```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<random-secret>
GOOGLE_CLIENT_ID=<google-web-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-web-oauth-client-secret>
ALLOWED_GOOGLE_DOMAIN=zodl.com
```

### Choose a read mode

Hosted API mode:

```env
XMONITOR_READ_API_BASE_URL=https://www.zodldashboard.com/api/v1
XMONITOR_BACKEND_API_BASE_URL=
```

Direct DB mode:

```env
XMONITOR_READ_API_BASE_URL=
XMONITOR_BACKEND_API_BASE_URL=
DATABASE_URL=postgres://user:password@localhost:5432/xmonitor
```

Apply migrations in direct DB mode:

```bash
npm run db:migrate
```

Run the app:

```bash
npm run dev
```

## Important Runtime Settings

Commonly used variables:

- Auth:
  - `NEXTAUTH_URL`
  - `NEXTAUTH_SECRET`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `ALLOWED_GOOGLE_DOMAIN`
- Read/proxy routing:
  - `XMONITOR_READ_API_BASE_URL`
  - `XMONITOR_BACKEND_API_BASE_URL`
  - `XMONITOR_API_PROXY_TIMEOUT_MS`
- Database:
  - `DATABASE_URL` or `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` / `PGSSLMODE`
- Retrieval/answers:
  - `XMONITOR_SEMANTIC_ENABLED`
  - `XMONITOR_EMBEDDING_BASE_URL`
  - `XMONITOR_EMBEDDING_MODEL`
  - `XMONITOR_EMBEDDING_API_KEY`
  - `XMONITOR_COMPOSE_ENABLED`
  - `XMONITOR_COMPOSE_MODEL`
  - `XMONITOR_COMPOSE_API_KEY`
  - `XMONITOR_COMPOSE_ASYNC_ENABLED`
  - `XMONITOR_COMPOSE_JOBS_QUEUE_URL`
- Email:
  - `XMONITOR_USER_PROXY_SECRET`
  - `XMONITOR_EMAIL_ENABLED`
  - `XMONITOR_EMAIL_SCHEDULES_ENABLED`
  - `XMONITOR_EMAIL_REQUIRE_OAUTH`
  - `XMONITOR_EMAIL_FROM_ADDRESS`
- Ingest:
  - `XMONITOR_INGEST_SHARED_SECRET`
  - `XMONITOR_INGEST_OMIT_HANDLES`

See [.env.example](.env.example) for the full current env template.

## Search and Answer Behavior

### Keyword mode

- Default search mode in the UI.
- Uses `/api/v1/feed`.
- Supports tier, handle, significance, date range, lexical text search, and pagination.

### Semantic mode

- Uses embeddings for natural-language retrieval.
- Uses `/api/v1/query/semantic`.

### Answer Mode

- Uses async compose jobs via `/api/v1/query/compose/jobs`.
- Grounds outputs in retrieved posts and citations.
- Uses a hidden evidence budget:
  - up to `150` retrieved candidates,
  - reranked and deduped,
  - up to `32` full normalized post bodies sent to synthesis.
- Draft outputs support `x_post`, `thread`, and `email`, with `email` as the default draft format.

## Active Route Surface

### App pages

- `/`
- `/signin`
- `/x-monitor`
- `/cipherpay-test`
- `/posts/{statusId}`
- `/regulatory-risk`
- `/app-stores`

### Public/read APIs

- `GET /api/v1/health`
- `GET /api/v1/feed`
- `GET /api/v1/posts/{statusId}`
- `GET /api/v1/trends`
- `GET /api/v1/window-summaries/latest`
- `POST /api/v1/cipherpay/webhook`
- `POST /api/v1/query/semantic`
- `POST /api/v1/query/compose`
- `POST /api/v1/query/compose/jobs`
- `GET /api/v1/query/compose/jobs/{jobId}`

### Internal/write APIs

- `POST /api/v1/ingest/posts/batch`
- `POST /api/v1/ingest/embeddings/batch`
- `POST /api/v1/ingest/window-summaries/batch`
- `POST /api/v1/ingest/runs`
- `GET /api/v1/cipherpay/dashboard`
- `GET /api/v1/cipherpay/config`
- `PUT /api/v1/cipherpay/config`
- `POST /api/v1/cipherpay/checkout`
- `POST /api/v1/cipherpay/sessions/{sessionId}/sync`

## NPM Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the local Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start the built app |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Apply SQL migrations |
| `npm run eval:compose` | Run compose evaluation tooling |

## Deployment

### Amplify

```bash
aws --profile zodldashboard --region us-east-1 amplify start-job \
  --app-id d2rgmein7vsf2e \
  --branch-name main \
  --job-type RELEASE
```

### Backend API Lambda

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
./scripts/aws/provision_vpc_api_lambda.sh
```

### Collector Lambdas

Priority collector:

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
X_API_BEARER_TOKEN='<x-api-bearer-token>' \
./scripts/aws/provision_x_api_collector_lambda.sh
```

Discovery collector:

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
X_API_BEARER_TOKEN='<x-api-bearer-token>' \
./scripts/aws/provision_x_api_discovery_collector_lambda.sh
```

### Smoke checks

```bash
curl -sS 'https://www.zodldashboard.com/api/v1/health'
curl -sS 'https://www.zodldashboard.com/api/v1/feed?limit=3'
curl -sS 'https://www.zodldashboard.com/api/v1/window-summaries/latest'
```

## Troubleshooting

### Sign-in issues

- Verify `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL`, and callback URLs.
- Verify internal users match `ALLOWED_GOOGLE_DOMAIN`.
- Verify guest users are allowlisted in `ALLOWED_GUEST_GOOGLE_EMAILS` when guest OAuth is enabled.

### Read path issues

- Confirm either `XMONITOR_READ_API_BASE_URL` or direct DB config is set.
- Confirm `XMONITOR_BACKEND_API_BASE_URL` is set when relying on local proxy routes.

### Semantic/Answer issues

- Confirm embedding credentials are configured.
- Confirm compose credentials, async queue, and compose worker are healthy.
- If the worker is VPC-attached, confirm outbound internet access exists for model API calls.

### Email issues

- Confirm `XMONITOR_EMAIL_ENABLED=true`.
- Confirm `XMONITOR_USER_PROXY_SECRET` matches between the web runtime and backend runtime.
- Confirm SES sender identity is verified.

## Documentation Index

Current architecture and operations:

- [docs/X_MONITOR_X_QUERY_AND_WATCHLIST_REFERENCE.md](docs/X_MONITOR_X_QUERY_AND_WATCHLIST_REFERENCE.md)
- [docs/X_MONITOR_CAPTURE_PIPELINE_AND_TUNING.md](docs/X_MONITOR_CAPTURE_PIPELINE_AND_TUNING.md)
- [docs/EMAIL_DRAFT_AND_SCHEDULE_ARCHITECTURE.md](docs/EMAIL_DRAFT_AND_SCHEDULE_ARCHITECTURE.md)
- [docs/openapi.v1.yaml](docs/openapi.v1.yaml)

## Security Notes

- Never commit live secrets.
- Keep OAuth credentials, model API keys, and ingest secrets in secure runtime config.
- Rotate secrets immediately if exposed.
- Restrict DB network access to trusted AWS resources.
- Keep local bypass disabled by default.

## License

All code in this workspace is licensed under either of:

- Apache License, Version 2.0 (see `LICENSE-APACHE` or <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT license (see `LICENSE-MIT` or <http://opensource.org/licenses/MIT>)

at your option.
