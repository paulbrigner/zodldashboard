# XMonitor AWS Re-Architecture Plan (Option 1 Hybrid)

_Last updated: 2026-02-22 (ET)_

## 1) Goal and constraints

### Goal
Move XMonitor from local-only storage + Signal-heavy delivery to an AWS-backed system with:
- durable cloud database,
- queryable web interface,
- reduced chat noise (Signal no longer primary UX).

### Constraints / decisions from Paul
- **No dual-write phase required** (beta system, breakage acceptable during transition).
- **Two-stream execution model:**
  1. **Stream A (this repo, Codex app):** AWS infra + API + MVP dashboard.
  2. **Stream B (OpenClaw local code, later):** rewire local collector to publish to AWS API.
- Migration order preference:
  1) stand up AWS DB,
  2) migrate local SQLite snapshot while local updates are paused,
  3) build MVP web feed (initially static until ingest resumes).

---

## 2) Current system snapshot (source system to migrate)

## Runtime
- Collection/processing scripts live at:
  - `/Users/paulbrigner/.openclaw/workspace/scripts/x_monitor_kb.py`
  - `/Users/paulbrigner/.openclaw/workspace/scripts/x_monitor_dispatch.py`
- Local database:
  - `/Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db`
- Scheduler:
  - launchd jobs (not OpenClaw cron) via:
    - `com.openclaw.xmonitor.priority`
    - `com.openclaw.xmonitor.discovery`
- Current outbound channel:
  - Signal group via dispatcher (`openclaw message send --channel signal ...`)

## Processing highlights
- Watchlist tiers: teammate / influencer / ecosystem.
- Significance scoring includes anti-spam + low-substance filtering.
- 24h engagement refresh implemented (`refresh-24h` mode).
- Embeddings currently generated with Venice endpoint + `text-embedding-bge-m3`.

## Current DB shape (for migration)
Tables to migrate:
- `tweets` (primary content + metrics + significance fields)
- `reports` (what has already been sent)
- `watch_accounts` (tier membership)
- `runs` (pipeline run audit)
- `tweet_embeddings` (vector payload currently as JSON)

Tables to ignore (local implementation details):
- `tweets_fts*` virtual/index tables
- `settings` (optional; mostly local runtime flags)

## Approximate row counts (at plan time)
- tweets: 309
- reports: 186
- watch_accounts: 42
- runs: 145
- tweet_embeddings: 308

---

## 3) Local update freeze procedure (before migration)

Use this to pause source-system mutations during export/import:

```bash
UID_NUM=$(id -u)

# stop jobs
launchctl bootout gui/$UID_NUM/com.openclaw.xmonitor.priority || true
launchctl bootout gui/$UID_NUM/com.openclaw.xmonitor.discovery || true

# optionally disable to prevent accidental relaunch
launchctl disable gui/$UID_NUM/com.openclaw.xmonitor.priority || true
launchctl disable gui/$UID_NUM/com.openclaw.xmonitor.discovery || true
```

Verification:
```bash
launchctl list | grep -E 'com.openclaw.xmonitor.(priority|discovery)'
# expect no active entries
```

Resume later:
```bash
UID_NUM=$(id -u)
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.openclaw.xmonitor.priority.plist
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.openclaw.xmonitor.discovery.plist
launchctl enable gui/$UID_NUM/com.openclaw.xmonitor.priority
launchctl enable gui/$UID_NUM/com.openclaw.xmonitor.discovery
```

---

## 4) Stream separation

## Stream A (Codex in this repo): AWS foundation
Owns:
- database provisioning,
- migration/import tooling,
- API surface,
- Amplify-hosted MVP UI.

## Stream B (OpenClaw local, later): collector integration
Owns:
- replacing Signal send path with AWS API publish path,
- post-migration ingest reactivation,
- optional retirement of local SQLite as system-of-record.

No local collector code changes are required to start Stream A.

---

## 5) Recommended AWS target architecture (Option 1 refined)

## Data plane
- **Aurora PostgreSQL (or RDS PostgreSQL)** as canonical DB.
- Why Postgres here:
  - straightforward relational migration from SQLite,
  - strong indexing/query support for dashboard filters,
  - managed backup/restore,
  - optional future `pgvector` if semantic search moves cloud-side.

## API plane
- Start simple:
  - Lambda + API Gateway REST, or
  - AppSync GraphQL if subscriptions are needed immediately.
- MVP requirement is feed visibility; subscriptions can be phase 2 if needed.

## Frontend
- Amplify-hosted web app:
  - read-only timeline/feed first,
  - filters by tier/author/significance/date,
  - detail panel for a post + metrics snapshots.

---

## 6) Phase plan (implementation order)

## Phase 0 — Repo bootstrap + architecture lock
Deliverables:
- ADR doc selecting Postgres + API style.
- Env matrix (dev/stage/prod if needed).
- Data contract version `v1`.

Exit criteria:
- team agreement on schema + ingest contract.

## Phase 1 — AWS DB provision + schema
Deliverables:
- Infra as code (CDK/Terraform/Amplify backend config).
- Tables/indexes created.
- Seeded reference data (`watch_accounts` optional).

Suggested core tables:
- `posts` (status_id PK, author, text, url, discovered_at, tier, significance flags)
- `post_metrics_snapshots` (status_id FK, captured_at, likes/reposts/replies/views, snapshot_type)
- `watch_accounts` (handle PK, tier, note, added_at)
- `reports` (status_id PK/FK, reported_at, channel, summary)
- `pipeline_runs` (run_at, mode, fetched_count, significant_count, reported_count, note)
- `embeddings` (status_id FK, backend/model/dims/vector payload or external pointer)

Exit criteria:
- DB up, schema applied, migration target ready.

## Phase 2 — One-time migration from local SQLite
Deliverables:
- Export utility that reads local sqlite and writes JSON/CSV batches.
- Import utility that upserts to AWS DB.
- Validation report (row counts + spot checks).

Suggested migration order:
1. `watch_accounts`
2. `posts` (`tweets` -> `posts`)
3. `post_metrics_snapshots` (derive initial + 24h snapshots from columns)
4. `reports`
5. `pipeline_runs`
6. `embeddings` (optional in MVP if not needed immediately)

Exit criteria:
- AWS row counts match expected tolerances.
- Random sample spot-checks pass.

## Phase 3 — MVP web app (read-only feed)
Deliverables:
- Amplify site with:
  - chronological feed,
  - filters (tier, handle, date window, significant only),
  - post detail view with metrics and links.
- Basic auth/guardrails (at minimum private access control).

Exit criteria:
- usable web UI over migrated data,
- acceptable query latency.

## Phase 4 — Re-enable live updates (Stream B handoff)
Deliverables:
- Local dispatcher/collector posts to AWS ingest API instead of Signal.
- Signal output either removed or reduced to critical alerts only.
- Local SQLite demoted to cache/transient store (or disabled).

Exit criteria:
- new posts appear in AWS/UI in near-real-time,
- no dependence on Signal for routine monitoring.

---

## 7) Codex: local SQLite access details (source migration input)

## Primary DB path
```bash
/Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db
```

## Safe local snapshot copy (recommended before migration)
```bash
DB_SRC="/Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db"
DB_SNAP="/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/xmonitor/xmonitor/data/x_monitor.snapshot.db"
mkdir -p "$(dirname \"$DB_SNAP\")"
cp "$DB_SRC" "$DB_SNAP"
```

## Quick schema introspection
```bash
python3 - <<'PY'
import sqlite3
con=sqlite3.connect('/Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db')
for t in ['tweets','reports','watch_accounts','runs','tweet_embeddings']:
    print('\n--',t)
    for c in con.execute(f'PRAGMA table_info({t})'):
        print(c)
PY
```

## Export example (JSONL)
```bash
python3 - <<'PY'
import sqlite3, json, pathlib
src='/Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db'
out=pathlib.Path('/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/xmonitor/xmonitor/data/export')
out.mkdir(parents=True, exist_ok=True)
con=sqlite3.connect(src)
con.row_factory=sqlite3.Row
for t in ['tweets','reports','watch_accounts','runs','tweet_embeddings']:
    with open(out/f'{t}.jsonl','w') as f:
        for r in con.execute(f'SELECT * FROM {t}'):
            f.write(json.dumps(dict(r), ensure_ascii=False)+'\n')
    print('wrote',t)
PY
```

## Field mapping notes
- `tweets.status_id` is unique post key (X status ID) and should remain canonical PK in cloud.
- `tweets.discovered_at` and `last_seen_at` are ISO strings in UTC-like format.
- `tweet_embeddings.vector_json` stores numeric arrays as JSON text.
- `reports` indicates already-notified posts; preserve for dedupe continuity.
- `runs` is append-only operational telemetry.

---

## 8) API contract draft for Stream B compatibility

Implement these endpoints in Stream A so local integration later is trivial:

- `POST /ingest/posts/batch`
  - upsert posts by `status_id`
- `POST /ingest/metrics/batch`
  - append metric snapshots (capture / refresh-24h)
- `POST /ingest/reports/batch`
  - mark reported posts
- `POST /ingest/runs`
  - append pipeline run telemetry
- `GET /feed?since=&tier=&handle=&significant=`
  - timeline for dashboard

Idempotency requirement:
- Every ingest endpoint must be safe to retry.
- Use `status_id` + timestamp keys for dedupe.

---

## 9) Non-goals for MVP

- No immediate cloud rewrite of X browser automation.
- No full observability stack on day 1.
- No semantic search UI requirement in MVP (can come after feed is stable).

---

## 10) Risks and mitigations

- **X source fragility (local browser auth/session):** keep ingest local until stable cloud alternative exists.
- **Migration drift during export:** freeze updates first (Phase 0/2 procedure).
- **Schema churn:** lock v1 contract before writing importer.
- **Cost creep:** keep MVP read-only and minimal API surface initially.

---

## 11) Acceptance checklist

- [ ] Local updates paused.
- [ ] AWS DB provisioned and schema applied.
- [ ] Local snapshot exported.
- [ ] Import completed and validated.
- [ ] Amplify feed UI rendering migrated records.
- [ ] Decision logged on when to re-enable live ingest to AWS.
