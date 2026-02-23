# XMonitor v1 — Proposed Postgres Schema + API Contract (Codex Baseline)

_Last updated: 2026-02-22 (ET)_

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
/Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db
```

Source tables to migrate:
- `tweets`
- `reports`
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
> - Keep both denormalized current metrics on `posts` and historical snapshots.

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
  watch_tier TEXT CHECK (watch_tier IN ('teammate','influencer','ecosystem')),

  is_significant BOOLEAN NOT NULL DEFAULT FALSE,
  significance_reason TEXT,
  significance_version TEXT DEFAULT 'v1',

  -- latest observed metrics
  likes INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,

  -- first-capture metrics
  initial_likes INTEGER,
  initial_reposts INTEGER,
  initial_replies INTEGER,
  initial_views INTEGER,

  -- 24h refresh metrics
  likes_24h INTEGER,
  reposts_24h INTEGER,
  replies_24h INTEGER,
  views_24h INTEGER,
  refresh_24h_at TIMESTAMPTZ,
  refresh_24h_status TEXT,
  refresh_24h_delta_likes INTEGER,
  refresh_24h_delta_reposts INTEGER,
  refresh_24h_delta_replies INTEGER,
  refresh_24h_delta_views INTEGER,

  discovered_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_discovered_at_desc ON posts (discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_significant_discovered ON posts (is_significant, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_watch_tier_discovered ON posts (watch_tier, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_handle_discovered ON posts (author_handle, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_refresh_24h_at ON posts (refresh_24h_at);
```

## 3.2 `post_metrics_snapshots`

```sql
CREATE TABLE IF NOT EXISTS post_metrics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id TEXT NOT NULL REFERENCES posts(status_id) ON DELETE CASCADE,

  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('initial_capture','latest_observed','refresh_24h')),
  snapshot_at TIMESTAMPTZ NOT NULL,

  likes INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,

  source TEXT DEFAULT 'ingest',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(status_id, snapshot_type, snapshot_at)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_status_time ON post_metrics_snapshots (status_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_type_time ON post_metrics_snapshots (snapshot_type, snapshot_at DESC);
```

## 3.3 `watch_accounts`

```sql
CREATE TABLE IF NOT EXISTS watch_accounts (
  handle CITEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('teammate','influencer','ecosystem')),
  note TEXT,
  added_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watch_accounts_tier ON watch_accounts (tier, handle);
```

## 3.4 `reports`

```sql
CREATE TABLE IF NOT EXISTS reports (
  status_id TEXT PRIMARY KEY REFERENCES posts(status_id) ON DELETE CASCADE,
  reported_at TIMESTAMPTZ NOT NULL,
  channel TEXT,
  summary TEXT,
  destination TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_reported_at_desc ON reports (reported_at DESC);
```

## 3.5 `pipeline_runs`

```sql
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('priority','discovery','both','refresh24h','manual')),

  fetched_count INTEGER NOT NULL DEFAULT 0,
  significant_count INTEGER NOT NULL DEFAULT 0,
  reported_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,

  source TEXT DEFAULT 'local-dispatcher',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(run_at, mode, source)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_mode_run_at_desc ON pipeline_runs (mode, run_at DESC);
```

## 3.6 `embeddings` (v1 compatibility)

```sql
CREATE TABLE IF NOT EXISTS embeddings (
  status_id TEXT PRIMARY KEY REFERENCES posts(status_id) ON DELETE CASCADE,

  backend TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,

  -- Keep JSON payload for simple migration parity with SQLite.
  -- Optional future: pgvector column + ANN index.
  vector_json JSONB NOT NULL,

  text_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings (model);
```

---

## 4) Migration mapping (SQLite -> Postgres)

## 4.1 Table mapping

- `tweets` -> `posts`
- `reports` -> `reports`
- `watch_accounts` -> `watch_accounts`
- `runs` -> `pipeline_runs`
- `tweet_embeddings` -> `embeddings`

## 4.2 Timestamp parsing

SQLite values are ISO-like text (`...+00:00`). Parse as UTC and write to `TIMESTAMPTZ`.

## 4.3 Snapshot derivation rules

For each migrated `posts` row, create snapshots:
1. `initial_capture` at `discovered_at` using `initial_*` (fallback to current metrics if null)
2. `latest_observed` at `last_seen_at` using current `likes/reposts/replies/views`
3. `refresh_24h` at `refresh_24h_at` if present, using `*_24h`

## 4.4 Data quality normalization

- Lowercase `author_handle` and `watch_accounts.handle` during import.
- Preserve `status_id` exactly as text.
- Drop orphan rows that violate FK integrity (log them for audit).

---

## 5) Minimal API contract (OpenAPI-style stub)

Base path proposal: `/v1`

### 5.1 Health
- `GET /health`
  - response: `{ "ok": true, "service": "xmonitor-api", "version": "v1" }`

### 5.2 Ingest endpoints

Auth requirement (v1 hardening):
- Require shared secret on all ingest routes via `x-api-key` (or `Authorization: Bearer ...`).
- Server env: `XMONITOR_INGEST_SHARED_SECRET`.

- `POST /ingest/posts/batch`
  - Upsert posts by `status_id`
  - Idempotent by PK

- `POST /ingest/metrics/batch`
  - Upsert snapshots by unique key `(status_id, snapshot_type, snapshot_at)`

- `POST /ingest/reports/batch`
  - Upsert report marker by `status_id`

- `POST /ingest/runs`
  - Upsert by `(run_at, mode, source)`

- `POST /ingest/watch-accounts/batch`
  - Upsert watchlist accounts by `handle`

### 5.3 Query endpoints (MVP dashboard)

- `GET /feed`
  - Query params:
    - `since` (ISO timestamp, optional)
    - `until` (ISO timestamp, optional)
    - `tier` (`teammate|influencer|ecosystem`, optional)
    - `handle` (optional)
    - `significant` (`true|false`, optional)
    - `q` (substring search over body/handle, optional)
    - `limit` (default 50, max 200)
    - `cursor` (opaque pagination token)
  - Returns newest-first items + next cursor.

- `GET /posts/{statusId}`
  - Returns post detail + snapshots + report state.

- `GET /watch-accounts`
  - Optional filter: `tier`

- `GET /stats/summary`
  - Returns counts (posts, significant, unreported, watchlist by tier).

---

## 6) OpenAPI YAML starter (copy into repo)

Create file: `docs/openapi.v1.yaml`

```yaml
openapi: 3.0.3
info:
  title: XMonitor API
  version: 1.0.0
servers:
  - url: /v1
paths:
  /health:
    get:
      summary: Health check
      responses:
        '200':
          description: OK
  /ingest/posts/batch:
    post:
      summary: Upsert posts by status_id
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                items:
                  type: array
                  items:
                    $ref: '#/components/schemas/PostUpsert'
      responses:
        '200': { description: Upsert summary }
  /ingest/metrics/batch:
    post:
      summary: Upsert metric snapshots
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                items:
                  type: array
                  items:
                    $ref: '#/components/schemas/MetricsSnapshotUpsert'
      responses:
        '200': { description: Upsert summary }
  /ingest/reports/batch:
    post:
      summary: Upsert report marks
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                items:
                  type: array
                  items:
                    $ref: '#/components/schemas/ReportUpsert'
      responses:
        '200': { description: Upsert summary }
  /ingest/runs:
    post:
      summary: Upsert pipeline run records
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PipelineRunUpsert'
      responses:
        '200': { description: Upsert summary }
  /feed:
    get:
      summary: Query timeline feed
      parameters:
        - in: query
          name: since
          schema: { type: string, format: date-time }
        - in: query
          name: until
          schema: { type: string, format: date-time }
        - in: query
          name: tier
          schema: { type: string, enum: [teammate, influencer, ecosystem] }
        - in: query
          name: handle
          schema: { type: string }
        - in: query
          name: significant
          schema: { type: boolean }
        - in: query
          name: q
          schema: { type: string }
        - in: query
          name: limit
          schema: { type: integer, default: 50, maximum: 200 }
        - in: query
          name: cursor
          schema: { type: string }
      responses:
        '200':
          description: Feed page
  /posts/{statusId}:
    get:
      summary: Get post detail
      parameters:
        - in: path
          name: statusId
          required: true
          schema: { type: string }
      responses:
        '200': { description: Post detail }
        '404': { description: Not found }
components:
  schemas:
    PostUpsert:
      type: object
      required: [status_id, url, author_handle, discovered_at, last_seen_at]
      properties:
        status_id: { type: string }
        url: { type: string }
        author_handle: { type: string }
        author_display: { type: string }
        body_text: { type: string }
        source_query: { type: string }
        watch_tier: { type: string, enum: [teammate, influencer, ecosystem] }
        is_significant: { type: boolean }
        significance_reason: { type: string }
        discovered_at: { type: string, format: date-time }
        last_seen_at: { type: string, format: date-time }
        likes: { type: integer }
        reposts: { type: integer }
        replies: { type: integer }
        views: { type: integer }
    MetricsSnapshotUpsert:
      type: object
      required: [status_id, snapshot_type, snapshot_at, likes, reposts, replies, views]
      properties:
        status_id: { type: string }
        snapshot_type: { type: string, enum: [initial_capture, latest_observed, refresh_24h] }
        snapshot_at: { type: string, format: date-time }
        likes: { type: integer }
        reposts: { type: integer }
        replies: { type: integer }
        views: { type: integer }
    ReportUpsert:
      type: object
      required: [status_id, reported_at]
      properties:
        status_id: { type: string }
        reported_at: { type: string, format: date-time }
        channel: { type: string }
        summary: { type: string }
        destination: { type: string }
    PipelineRunUpsert:
      type: object
      required: [run_at, mode]
      properties:
        run_at: { type: string, format: date-time }
        mode: { type: string, enum: [priority, discovery, both, refresh24h, manual] }
        fetched_count: { type: integer }
        significant_count: { type: integer }
        reported_count: { type: integer }
        note: { type: string }
        source: { type: string }
```

---

## 7) Implementation status (current)

- [x] SQL migration files implemented in `db/migrations/`.
- [x] SQLite export/import/validation tooling implemented in `scripts/migrate/`.
- [x] Ingest and read API routes implemented and deployed.
- [x] Cursor-based feed pagination implemented (`discovered_at` + `status_id`).
- [x] Idempotent upsert behavior implemented across ingest routes.
- [x] Amplify-hosted feed and post-detail pages deployed.
- [x] Ingest shared-secret auth enforced on all write routes.

---

## 8) Future-compatible extensions (not required for v1)

- Add `pgvector` and ANN indexing for semantic retrieval.
- Add websocket/subscription stream for near-real-time UI updates.
- Add role-based auth (admin vs viewer).
- Add S3 archive export for long-term cold storage.
