# XMonitor AWS Migration Runbook (v1)

_Last updated: 2026-02-22 (ET)_

This runbook is the execution companion to:
- `docs/AWS_MIGRATION_PLAN.md`
- `docs/POSTGRES_SCHEMA_AND_OPENAPI_V1.md`
- `docs/openapi.v1.yaml`

It is written so Codex can execute migration in a predictable order.

---

## 0) Outcome of this runbook

When complete, you should have:
1. AWS Postgres provisioned and schema applied.
2. Local SQLite snapshot exported and imported to AWS.
3. A read-only MVP web feed running in Amplify (historical data visible).
4. Local X update jobs still paused (until explicit re-enable step).

---

## 1) Prerequisites

## Local machine prerequisites
- Access to source DB:
  - `/Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db`
- Python 3
- `psql` client installed
- AWS CLI configured for target account/region

## AWS prerequisites
- AWS account + IAM permissions for:
  - RDS/Aurora Postgres
  - Secrets Manager (recommended)
  - API Gateway / Lambda (or AppSync stack)
  - Amplify Hosting
- VPC/subnet/security group plan for DB access

## Repo paths
```bash
ROOT="/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/xmonitor/xmonitor"
DOCS="$ROOT/docs"
DATA="$ROOT/data"
EXPORT="$DATA/export"
mkdir -p "$DATA" "$EXPORT"
```

---

## 2) Freeze local updates (MANDATORY before snapshot)

Stop local launchd collectors to avoid DB mutations during migration.

```bash
UID_NUM=$(id -u)

launchctl bootout gui/$UID_NUM/com.openclaw.xmonitor.priority || true
launchctl bootout gui/$UID_NUM/com.openclaw.xmonitor.discovery || true

# prevent accidental relaunch
launchctl disable gui/$UID_NUM/com.openclaw.xmonitor.priority || true
launchctl disable gui/$UID_NUM/com.openclaw.xmonitor.discovery || true
```

Verify they are not active:
```bash
launchctl list | grep -E 'com.openclaw.xmonitor.(priority|discovery)'
# expect no active entries
```

---

## 3) Create immutable local DB snapshot

```bash
DB_SRC="/Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db"
DB_SNAP="$DATA/x_monitor.snapshot.db"
cp "$DB_SRC" "$DB_SNAP"
```

Optional quick integrity check:
```bash
python3 - <<'PY'
import sqlite3, sys
p = "/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/xmonitor/xmonitor/data/x_monitor.snapshot.db"
con = sqlite3.connect(p)
print(con.execute("PRAGMA integrity_check").fetchone()[0])
PY
```

Expected output: `ok`

---

## 4) Capture source-of-truth counts (for validation later)

```bash
python3 - <<'PY'
import sqlite3, json
p = "/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/xmonitor/xmonitor/data/x_monitor.snapshot.db"
con = sqlite3.connect(p)
counts = {}
for t in ["tweets","reports","watch_accounts","runs","tweet_embeddings"]:
    counts[t] = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
print(json.dumps(counts, indent=2))
PY
```

Save this output in migration notes.

---

## 5) Export snapshot to JSONL

```bash
python3 - <<'PY'
import sqlite3, json, pathlib
src = "/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/xmonitor/xmonitor/data/x_monitor.snapshot.db"
out = pathlib.Path("/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/xmonitor/xmonitor/data/export")
out.mkdir(parents=True, exist_ok=True)
con = sqlite3.connect(src)
con.row_factory = sqlite3.Row

for t in ["tweets","reports","watch_accounts","runs","tweet_embeddings"]:
    fp = out / f"{t}.jsonl"
    with open(fp, "w", encoding="utf-8") as f:
        for r in con.execute(f"SELECT * FROM {t}"):
            f.write(json.dumps(dict(r), ensure_ascii=False) + "\n")
    print(f"wrote {fp}")
PY
```

---

## 6) Provision AWS Postgres

Implement via IaC in this repo (CDK/Terraform/etc).

Minimum requirements:
- Postgres 15+
- automated backups enabled
- deletion protection ON (recommended)
- credentials in Secrets Manager
- reachable from migration runner host

Record connection values as env vars:
```bash
export PGHOST="..."
export PGPORT="5432"
export PGDATABASE="xmonitor"
export PGUSER="..."
export PGPASSWORD="..."
```

---

## 7) Apply v1 schema

Use schema from `POSTGRES_SCHEMA_AND_OPENAPI_V1.md` (Section 3) via migration SQL file.

Example:
```bash
psql "$PGDATABASE" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -f "$ROOT/db/migrations/001_init.sql"
```

Sanity check tables:
```bash
psql "$PGDATABASE" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -c "\dt"
```

---

## 8) Import data into Postgres (one-time)

Import order:
1. watch_accounts
2. posts
3. reports
4. pipeline_runs
5. embeddings
6. post_metrics_snapshots (derived from posts)

## 8.1 Recommended importer strategy

Implement script in repo (Codex task):
- `scripts/migrate/import_sqlite_jsonl_to_postgres.py`

Behavior requirements:
- idempotent upserts
- lower-case handles
- parse timestamps to `TIMESTAMPTZ`
- preserve `status_id` exactly
- log rejected rows

## 8.2 Minimal SQL upsert patterns (reference)

### watch_accounts
```sql
INSERT INTO watch_accounts(handle, tier, note, added_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (handle) DO UPDATE SET
  tier = EXCLUDED.tier,
  note = EXCLUDED.note,
  added_at = EXCLUDED.added_at,
  updated_at = now();
```

### posts
```sql
INSERT INTO posts (...)
VALUES (...)
ON CONFLICT (status_id) DO UPDATE SET
  ...,
  updated_at = now();
```

### reports
```sql
INSERT INTO reports(status_id, reported_at, channel, summary, destination)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (status_id) DO UPDATE SET
  reported_at = EXCLUDED.reported_at,
  channel = EXCLUDED.channel,
  summary = EXCLUDED.summary,
  destination = EXCLUDED.destination;
```

### pipeline_runs
```sql
INSERT INTO pipeline_runs(run_at, mode, fetched_count, significant_count, reported_count, note, source)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (run_at, mode, source) DO UPDATE SET
  fetched_count = EXCLUDED.fetched_count,
  significant_count = EXCLUDED.significant_count,
  reported_count = EXCLUDED.reported_count,
  note = EXCLUDED.note;
```

### embeddings
```sql
INSERT INTO embeddings(status_id, backend, model, dims, vector_json, text_hash, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
ON CONFLICT (status_id) DO UPDATE SET
  backend = EXCLUDED.backend,
  model = EXCLUDED.model,
  dims = EXCLUDED.dims,
  vector_json = EXCLUDED.vector_json,
  text_hash = EXCLUDED.text_hash,
  updated_at = EXCLUDED.updated_at;
```

## 8.3 Derive metrics snapshots after posts import

```sql
-- initial_capture
INSERT INTO post_metrics_snapshots(status_id, snapshot_type, snapshot_at, likes, reposts, replies, views, source)
SELECT
  p.status_id,
  'initial_capture',
  p.discovered_at,
  COALESCE(p.initial_likes, p.likes, 0),
  COALESCE(p.initial_reposts, p.reposts, 0),
  COALESCE(p.initial_replies, p.replies, 0),
  COALESCE(p.initial_views, p.views, 0),
  'sqlite_migration'
FROM posts p
ON CONFLICT (status_id, snapshot_type, snapshot_at) DO NOTHING;

-- latest_observed
INSERT INTO post_metrics_snapshots(status_id, snapshot_type, snapshot_at, likes, reposts, replies, views, source)
SELECT
  p.status_id,
  'latest_observed',
  p.last_seen_at,
  COALESCE(p.likes, 0),
  COALESCE(p.reposts, 0),
  COALESCE(p.replies, 0),
  COALESCE(p.views, 0),
  'sqlite_migration'
FROM posts p
ON CONFLICT (status_id, snapshot_type, snapshot_at) DO NOTHING;

-- refresh_24h (only where available)
INSERT INTO post_metrics_snapshots(status_id, snapshot_type, snapshot_at, likes, reposts, replies, views, source)
SELECT
  p.status_id,
  'refresh_24h',
  p.refresh_24h_at,
  COALESCE(p.likes_24h, p.likes, 0),
  COALESCE(p.reposts_24h, p.reposts, 0),
  COALESCE(p.replies_24h, p.replies, 0),
  COALESCE(p.views_24h, p.views, 0),
  'sqlite_migration'
FROM posts p
WHERE p.refresh_24h_at IS NOT NULL
ON CONFLICT (status_id, snapshot_type, snapshot_at) DO NOTHING;
```

---

## 9) Post-import validation checklist

## 9.1 Row count parity

Compare local snapshot vs AWS:

```bash
# local counts
python3 - <<'PY'
import sqlite3
p="/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/xmonitor/xmonitor/data/x_monitor.snapshot.db"
con=sqlite3.connect(p)
for t in ["tweets","reports","watch_accounts","runs","tweet_embeddings"]:
    print(t, con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
PY

# aws counts
psql "$PGDATABASE" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" <<'SQL'
SELECT 'posts', COUNT(*) FROM posts
UNION ALL SELECT 'reports', COUNT(*) FROM reports
UNION ALL SELECT 'watch_accounts', COUNT(*) FROM watch_accounts
UNION ALL SELECT 'pipeline_runs', COUNT(*) FROM pipeline_runs
UNION ALL SELECT 'embeddings', COUNT(*) FROM embeddings
UNION ALL SELECT 'post_metrics_snapshots', COUNT(*) FROM post_metrics_snapshots;
SQL
```

## 9.2 Spot checks
- random 20 `status_id`s:
  - url, handle, body_text, is_significant, discovered_at
- verify watchlist tier counts
- verify reports dedupe continuity (same status IDs marked reported)

---

## 10) Bring up API and MVP web feed

## API
- Implement endpoints from `openapi.v1.yaml`.
- Deploy API and run smoke tests:
  - `GET /health`
  - `GET /feed?limit=20`
  - `GET /posts/{statusId}` for known IDs

## Amplify MVP
- Build read-only feed UI:
  - newest-first timeline,
  - filters: tier, handle, date range, significant only,
  - post detail panel.

Acceptance for this stage:
- historical migrated records render end-to-end.

---

## 11) Keep local updates OFF until Stream B is ready

Do **not** re-enable launchd jobs yet if you want static beta UI.

When you later choose to resume live updates (Stream B complete), re-enable:

```bash
UID_NUM=$(id -u)
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.openclaw.xmonitor.priority.plist
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.openclaw.xmonitor.discovery.plist
launchctl enable gui/$UID_NUM/com.openclaw.xmonitor.priority
launchctl enable gui/$UID_NUM/com.openclaw.xmonitor.discovery
```

---

## 12) Rollback / recovery

If migration/import is bad:
1. Drop/recreate cloud tables (or restore DB snapshot).
2. Re-run import from immutable snapshot DB.
3. If needed, restore local behavior by re-enabling launchd jobs.

Emergency local restore commands:
```bash
UID_NUM=$(id -u)
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.openclaw.xmonitor.priority.plist
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.openclaw.xmonitor.discovery.plist
launchctl enable gui/$UID_NUM/com.openclaw.xmonitor.priority
launchctl enable gui/$UID_NUM/com.openclaw.xmonitor.discovery
```

---

## 13) Codex task list (copy/paste)

- [ ] Implement `db/migrations/001_init.sql` from schema doc.
- [ ] Implement `scripts/migrate/export_sqlite.py` (if needed in repo) and `import_sqlite_jsonl_to_postgres.py`.
- [ ] Add validation script `scripts/migrate/validate_counts.py`.
- [ ] Implement API from `docs/openapi.v1.yaml`.
- [ ] Deploy API + Amplify read-only feed.
- [ ] Document env variables + secrets path in `README`.
- [ ] Run full migration dry-run on non-prod DB.
- [ ] Run production migration with local jobs paused.
