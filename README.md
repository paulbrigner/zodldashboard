# XMonitor Stream A (AWS Foundation)

This repository now tracks Stream A for XMonitor:

- canonical cloud data model in PostgreSQL,
- one-time migration tooling from local SQLite,
- API contract implementation for ingest + read,
- Amplify-hosted web UI for read-only feed.

Stream B (local OpenClaw collector rewiring) remains out of scope here.

## Architecture summary

- Frontend: Next.js App Router deployed via Amplify.
- Auth: NextAuth Google OAuth with domain restriction.
- API: Next.js route handlers under `/api/v1/*`.
- Storage: PostgreSQL with schema migrations in `db/migrations`.
- Migration tooling: Python scripts in `scripts/migrate`.

## Required docs

Implementation baseline is documented in:

1. `docs/AWS_MIGRATION_PLAN.md`
2. `docs/POSTGRES_SCHEMA_AND_OPENAPI_V1.md`
3. `docs/openapi.v1.yaml`
4. `docs/AWS_MIGRATION_RUNBOOK.md`
5. `docs/CODEX_HANDOFF_STREAM_A.md`

## Prerequisites

- Node.js 22.x
- npm
- Python 3.10+
- `psql`
- PostgreSQL 15+ target (local or AWS)

For import/validation scripts:

```bash
python3 -m pip install psycopg[binary]
```

## Environment

Copy `.env.example` to `.env.local` and set values.

```bash
cp .env.example .env.local
```

Generate a local NextAuth secret:

```bash
openssl rand -base64 32
```

## Install and run

```bash
npm install
npm run dev
```

Key pages:

- `/signin` for Google login
- `/oauth-probe` for Workspace policy diagnostics
- `/` read-only feed UI (requires auth)

## Database migrations

Migrations live in `db/migrations/`.

Apply migrations using `DATABASE_URL`:

```bash
DATABASE_URL='postgres://user:pass@localhost:5432/xmonitor' npm run db:migrate
```

Or using `PG*` vars:

```bash
PGHOST=localhost PGPORT=5432 PGDATABASE=xmonitor PGUSER=postgres PGPASSWORD=postgres npm run db:migrate
```

## SQLite migration tooling

### 1) Export local SQLite to JSONL

```bash
python3 scripts/migrate/export_sqlite.py \
  --sqlite-path /Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db \
  --out-dir data/export
```

### 2) Import JSONL into Postgres

```bash
DATABASE_URL='postgres://user:pass@localhost:5432/xmonitor' \
python3 scripts/migrate/import_sqlite_jsonl_to_postgres.py \
  --input-dir data/export \
  --reject-log data/import_rejects.ndjson
```

### 3) Validate source vs target counts

```bash
DATABASE_URL='postgres://user:pass@localhost:5432/xmonitor' \
python3 scripts/migrate/validate_counts.py \
  --sqlite-path data/x_monitor.snapshot.db
```

## API surface

OpenAPI source: `docs/openapi.v1.yaml`

Implemented under `/api/v1`:

- `GET /health`
- `POST /ingest/posts/batch`
- `POST /ingest/metrics/batch`
- `POST /ingest/reports/batch`
- `POST /ingest/runs`
- `GET /feed`
- `GET /posts/{statusId}`

## Current scope boundaries

In scope here:

- DB schema + migration tooling
- API + read-only feed UI
- migration validation helpers

Out of scope here:

- modifying local OpenClaw scripts under `~/.openclaw/workspace/scripts`
- re-enabling local launchd jobs
- Signal behavior redesign
