# Codex Handoff — Stream A (AWS Foundation)

_Last updated: 2026-02-22 (ET)_

This is the primary handoff document for **ChatGPT Codex app** to implement Stream A.

## Mission
Build the AWS-side system for XMonitor using **Postgres** (not DynamoDB), migrate local SQLite data once, and ship an Amplify-hosted MVP feed UI.

## Explicit product decisions
1. Use **Postgres** as canonical cloud DB.
2. No dual-write migration phase required (beta tolerance for temporary downtime).
3. Keep Stream A and Stream B separate:
   - **Stream A (this repo):** AWS infra + DB + migration + API + MVP UI.
   - **Stream B (later, elsewhere):** local OpenClaw collector publishes to API.
4. Signal is no longer primary interface (web UI is primary target).

---

## Required reading order (before coding)
1. `docs/AWS_MIGRATION_PLAN.md`
2. `docs/POSTGRES_SCHEMA_AND_OPENAPI_V1.md`
3. `docs/openapi.v1.yaml`
4. `docs/AWS_MIGRATION_RUNBOOK.md`

Do not start implementation until these are read and acknowledged in your first commit message/PR description.

---

## Scope boundaries (very important)

## In scope for Codex now
- AWS DB provisioning and schema migrations.
- One-time migration tooling from local SQLite snapshot to Postgres.
- API implementation for ingest + query endpoints.
- Amplify MVP web app (read-only feed + filters).
- Validation scripts and runbook automation helpers.

## Out of scope for Codex now
- Editing local OpenClaw runtime scripts in `~/.openclaw/workspace/scripts`.
- Re-enabling local launchd jobs.
- Rewiring Signal behavior.
- Redesigning significance logic.

---

## Source data / local paths

Primary local source DB:
```bash
/Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db
```

Repo root:
```bash
/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/xmonitor/xmonitor
```

Docs folder:
```bash
/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/xmonitor/xmonitor/docs
```

Use the runbook freeze/snapshot steps exactly before migration execution.

---

## Implementation plan (Codex execution sequence)

## Phase A — Repo baseline + architecture lock
Deliverables:
- `README` section: architecture summary + stream separation.
- `docs/ADR-0001-postgres-over-dynamodb.md` capturing rationale.
- Environment template (`.env.example`) with all required keys/vars.

Acceptance:
- ADR committed.
- env contract documented.

## Phase B — Database + migrations
Deliverables:
- SQL migrations in `db/migrations/` implementing schema from `POSTGRES_SCHEMA_AND_OPENAPI_V1.md`.
- Optional local dev `docker-compose` for Postgres.
- Migration runner command (e.g., npm/pnpm script).

Acceptance:
- Fresh DB applies migrations cleanly.
- Re-run is idempotent.

## Phase C — Migration tooling (SQLite -> Postgres)
Deliverables:
- `scripts/migrate/export_sqlite.py` (or use existing runbook export flow)
- `scripts/migrate/import_sqlite_jsonl_to_postgres.py`
- `scripts/migrate/validate_counts.py`

Rules:
- idempotent upserts.
- preserve `status_id` as canonical PK.
- lowercase handles.
- parse timestamps into timestamptz.
- log and count rejects.

Acceptance:
- counts parity check passes within expected tolerances.
- spot-check script validates random rows.

## Phase D — API implementation
Deliverables:
- endpoint implementation aligned to `docs/openapi.v1.yaml`:
  - `/health`
  - `/ingest/posts/batch`
  - `/ingest/metrics/batch`
  - `/ingest/reports/batch`
  - `/ingest/runs`
  - `/feed`
  - `/posts/{statusId}`
- pagination + filtering on feed.
- basic integration tests.

Acceptance:
- OpenAPI contract and implementation in sync.
- tests pass in CI.

## Phase E — Amplify MVP (read-only)
Deliverables:
- Feed page:
  - newest-first list
  - filter controls: tier, handle, significant, date range, text query
- Detail drawer/page for selected post.

Acceptance:
- migrated historical data is visible from UI.
- no live ingest dependency required for initial demo.

---

## Suggested repo layout

```text
/db
  /migrations
/scripts
  /migrate
/src
  /api
  /domain
  /db
/amplify
/apps
  /web
/docs
```

(Adapt if your framework prefers a different structure; keep responsibilities clear.)

---

## API and data design rules

1. **Idempotency first**
   - batch ingest must be retry-safe.
   - use deterministic conflict keys.

2. **Do not over-normalize v1**
   - optimize for migration speed and feed queries.

3. **Keep migration reproducible**
   - snapshot-in, deterministic import, deterministic validation output.

4. **Avoid hidden transforms**
   - document every mapping and normalization in code comments.

5. **No secrets in repo**
   - use environment and secrets manager only.

---

## CI/CD baseline expectations

- Lint + typecheck (if typed stack).
- Migration validation in CI.
- API tests in CI.
- Build/deploy preview for web app (if branch previews enabled).

Minimum PR quality gate:
- failing migration/test blocks merge.

---

## Definition of done (Stream A MVP)

All must be true:
- [ ] Postgres schema deployed in AWS.
- [ ] Local SQLite snapshot migrated successfully.
- [ ] Validation report committed (counts + sample checks).
- [ ] API endpoints live and tested.
- [ ] Amplify web feed displays migrated posts.
- [ ] Documentation updated (`README` + runbook references).

---

## First PR target (strong recommendation)

Start with one focused PR:

**PR-1: DB foundation + migration skeleton**
- add migration SQL files,
- add importer skeleton + TODO markers,
- add ADR for Postgres decision,
- add `.env.example`.

This reduces risk and allows early review before API/UI work.

---

## Copy/paste kickoff prompt for Codex

```text
You are implementing Stream A for XMonitor in this repository.

Before coding, read:
- docs/AWS_MIGRATION_PLAN.md
- docs/POSTGRES_SCHEMA_AND_OPENAPI_V1.md
- docs/openapi.v1.yaml
- docs/AWS_MIGRATION_RUNBOOK.md
- docs/CODEX_HANDOFF_STREAM_A.md

Requirements:
1) Use Postgres as canonical DB.
2) No dual-write migration phase.
3) Build DB migrations + one-time SQLite migration tooling first.
4) Implement API endpoints from openapi.v1.yaml.
5) Build Amplify MVP read-only feed.
6) Keep local OpenClaw runtime scripts out of scope.

Start with PR-1:
- Add DB migration files.
- Add ADR doc for Postgres decision.
- Add migration script skeleton and .env.example.
- Include clear run commands in README.

Show a concise implementation plan, then execute.
```
