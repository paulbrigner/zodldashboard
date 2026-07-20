# XMonitor v1 — Proposed Postgres Schema + API Contract (Codex Baseline)

_Last updated: 2026-07-20 (ET)_

This document defines the canonical v1 data model and API contract used by the live system:
- provision AWS database,
- define ingest/query API,
- enable one-time migration from local SQLite,
- support the Amplify-hosted feed UI.

---

## 1) Scope and assumptions

## In-scope
- PostgreSQL schema for canonical cloud storage.
- Minimal ingest + query API contract.
- One-time migration mapping from local SQLite.
- MVP feed/read endpoints for web dashboard.

## Out-of-scope (for this v1)
- Replacing local X capture/browser automation.
- Full cloud rewrite of collector.
- Advanced authz roles and granular tenanting.
- Real-time subscriptions beyond a basic polling feed (can be phase 2).

---

## 2) Source database (current local)

Primary source file:
```bash
~/.openclaw/workspace/memory/x_monitor.db
```

Source tables to migrate:
- `tweets`
- `watch_accounts`
- `runs`
- `tweet_embeddings`

Ignore local-only internals:
- `tweets_fts*`
- `settings`

---

## 3) Postgres schema (v1)

> Design notes:
> - Keep schema practical and migration-safe.
> - Use `TEXT + CHECK` instead of enums for beta agility.
> - Keep the live backend schema aligned with the active collector/runtime only.

## Extensions (recommended)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive handles (optional)
```

## 3.1 `posts`

```sql
CREATE TABLE IF NOT EXISTS posts (
  status_id TEXT PRIMARY KEY,                    -- X status id, keep text for compatibility
  url TEXT NOT NULL,

  author_handle CITEXT NOT NULL,
  author_display TEXT,

  body_text TEXT,
  posted_relative TEXT,

  source_query TEXT,                             -- priority | discovery | both | legacy
  watch_tier TEXT CHECK (watch_tier IN ('teammate','investor','influencer','ecosystem')),

  is_significant BOOLEAN NOT NULL DEFAULT FALSE,
  significance_reason TEXT,
  significance_version TEXT DEFAULT 'v1',

  -- latest observed metrics
  likes INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,

  discovered_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_discovered_at_desc ON posts (discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_significant_discovered ON posts (is_significant, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_watch_tier_discovered ON posts (watch_tier, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_handle_discovered ON posts (author_handle, discovered_at DESC);
```

## 3.2 `watch_accounts`

```sql
CREATE TABLE IF NOT EXISTS watch_accounts (
  handle CITEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('teammate','investor','influencer','ecosystem')),
  note TEXT,
  added_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watch_accounts_tier ON watch_accounts (tier, handle);
```

## 3.3 `pipeline_runs`

```sql
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('priority','discovery','both','manual')),

  fetched_count INTEGER NOT NULL DEFAULT 0,
  significant_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,

  source TEXT DEFAULT 'local-dispatcher',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(run_at, mode, source)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_mode_run_at_desc ON pipeline_runs (mode, run_at DESC);
```

## 3.4 `embeddings` (semantic-ready)

```sql
CREATE TABLE IF NOT EXISTS embeddings (
  status_id TEXT PRIMARY KEY REFERENCES posts(status_id) ON DELETE CASCADE,

  backend TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,

  vector_json JSONB NOT NULL,
  embedding vector,

  text_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings (model);
CREATE INDEX IF NOT EXISTS idx_embeddings_model_dims ON embeddings (model, dims);
```

---

## 4) Migration mapping (SQLite -> Postgres)

## 4.1 Table mapping

- `tweets` -> `posts`
- `watch_accounts` -> `watch_accounts`
- `runs` -> `pipeline_runs`
- `tweet_embeddings` -> `embeddings`

## 4.2 Timestamp parsing

SQLite values are ISO-like text (`...+00:00`). Parse as UTC and write to `TIMESTAMPTZ`.

## 4.3 Data quality normalization

- Lowercase `author_handle` and `watch_accounts.handle` during import.
- Preserve `status_id` exactly as text.
- Drop orphan rows that violate FK integrity (log them for audit).

---

## 5) Minimal API contract (OpenAPI-style stub)

Base path proposal: `/v1`

### 5.1 Health
- `GET /health`
  - unsigned, for infrastructure health checks
  - response: `{ "ok": true, "service": "xmonitor-api", "version": "v1" }`

### 5.2 Ingest endpoints

Auth requirement (v1 hardening):
- Require shared secret on all ingest routes via `x-api-key` (or `Authorization: Bearer ...`).
- Server env: `XMONITOR_INGEST_SHARED_SECRET`.

- `POST /ingest/posts/batch`
  - Upsert posts by `status_id`
  - Idempotent by PK

- `POST /ingest/runs`
  - Upsert by `(run_at, mode, source)`

- `POST /ingest/watch-accounts/batch`
  - Upsert watchlist accounts by `handle`

### 5.3 Query endpoints (MVP dashboard)

Direct backend read authentication:

- Require `x-xmonitor-client-id` and `x-xmonitor-client-secret` on feed,
  author-location, engagement, trend, latest-summary, and post-detail reads.
- Validate each client against the `read_clients` map in the backend-only Secrets Manager secret selected by `XMONITOR_READ_CLIENTS_SECRET_ID`.
  Each server-side host uses its own secret; up to three active
  secrets per client support rotation.
- Legacy array entries grant `read` only. A client may call semantic retrieval
  only when its entry is an object with `capabilities: ["read",
  "semantic:query"]`; this does not grant Compose or any write operation.
- Capability-bearing semantic clients are subject to atomic five-minute and
  daily budgets in `xmonitor_client_usage_windows`. The
  `XMONITOR_SEMANTIC_CLIENT_QUERY_ENABLED` switch can stop this client flow
  without disabling the viewer-proxy semantic flow.
- Do not expose the client secret to browser JavaScript. Browser requests use
  the dashboard `/api/v1` BFF, which verifies the viewer session and X Monitor
  permission before injecting its server-side credential.

- `GET /feed`
  - Query params:
    - `since` (ISO timestamp, optional)
    - `until` (ISO timestamp, optional)
    - `tier` (`teammate|investor|influencer|ecosystem`, optional)
    - `handle` (optional)
    - `significant` (`true|false`, optional)
    - `q` (substring search over body/handle, optional)
    - `limit` (default 50, max 200)
    - `cursor` (opaque pagination token)
  - Returns newest-first items + next cursor.

- `GET /posts/{statusId}`
  - Returns post detail.

- `GET /watch-accounts`
  - Optional filter: `tier`

- `GET /stats/summary`
  - Returns counts (posts, significant, unreported, watchlist by tier).

---

## 6) OpenAPI contract

`docs/openapi.v1.yaml` is the canonical machine-readable contract. Keep auth
requirements and route changes there instead of maintaining a second embedded
YAML copy in this overview.

---

## 7) Implementation status (current)

- [x] SQL migration files implemented in `db/migrations/`.
- [x] SQLite export/import/validation tooling implemented in `scripts/migrate/`.
- [x] Ingest and read API routes implemented and deployed.
- [x] Cursor-based feed pagination implemented (`discovered_at` + `status_id`).
- [x] Idempotent upsert behavior implemented across ingest routes.
- [x] Amplify-hosted feed and post-detail pages deployed.
- [x] Ingest shared-secret auth enforced on all write routes.
- [x] Per-client authentication enforced on direct backend read routes.
- [x] Viewer authentication and X Monitor authorization enforced at the browser BFF.

---

## 8) Future-compatible extensions (not required for v1)

- Add websocket/subscription stream for near-real-time UI updates.
- Add role-based auth (admin vs viewer).
- Add S3 archive export for long-term cold storage.

## 9) TODO (UI polling optimization)

- Add a lightweight latest-pointer endpoint for feed freshness checks (example: `GET /feed/latest`), so dashboard polling does not need to call `GET /feed?limit=1`.
- Endpoint should return only minimal freshness metadata (for example `status_id` + `discovered_at` or a single opaque `latest_key`).
- Add `ETag`/`If-None-Match` support to return `304 Not Modified` when no new matching data exists.
