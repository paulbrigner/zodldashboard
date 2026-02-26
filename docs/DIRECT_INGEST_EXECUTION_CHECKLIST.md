# XMonitor Direct Ingest Cutover - Execution Checklist

_Last updated: 2026-02-26 (ET)_

This checklist turns the transition strategy in `docs/DIRECT_INGEST_API_TRANSITION_PLAN.md` into an operator sequence with explicit stop/go gates.

## 0) Current status snapshot (as of 2026-02-26)

- [x] Stream A API ingest routes exist (`/v1/ingest/posts|metrics|reports/batch`, `/v1/ingest/runs`).
- [x] Ingest auth gate exists (`x-api-key` or `Authorization: Bearer`).
- [x] SQLite export/import/validate scripts exist in this repo (`scripts/migrate/`).
- [x] Stream B dispatcher now uses direct ingest runtime path (`x_monitor_dispatch.py` -> `x_monitor_ingest_api.py`).
- [x] `x_monitor_sync_api.py` removed from active dispatcher path (legacy script retained only as fallback/manual utility).
- [ ] Local SQLite is still used for collector-side state/scoring (server-side state ownership remains a separate follow-up).

## 1) Roles and scope

- Stream A (this repo): API and database contract, migration tooling, hosted health/read/write checks.
- Stream B (`~/.openclaw/workspace`): collector/dispatcher runtime, launchd jobs, cutover from sync path to direct-ingest path.
- This checklist covers both, but most cutover actions are Stream B.

## 2) Pre-cutover readiness gate (must pass all)

- [ ] AWS CLI identity is active for intended account:

```bash
aws --profile zodldashboard --region us-east-1 sts get-caller-identity
```

- [ ] Hosted app/API basic health is green:

```bash
curl -sS 'https://www.zodldashboard.com/api/v1/health'
curl -sS 'https://www.zodldashboard.com/api/v1/feed?limit=3'
```

- [ ] Ingest auth behavior is correct (unauthorized without key, authorized with key):

```bash
curl -i -X POST 'https://www.zodldashboard.com/api/v1/ingest/runs' \
  -H 'content-type: application/json' \
  --data '{"run_at":"2026-02-26T00:00:00Z","mode":"manual"}'
```

```bash
curl -i -X POST 'https://www.zodldashboard.com/api/v1/ingest/runs' \
  -H 'content-type: application/json' \
  -H "x-api-key: $XMONITOR_API_KEY" \
  --data '{"run_at":"2026-02-26T00:00:00Z","mode":"manual"}'
```

- [ ] OpenClaw runtime env has API target + key populated (same shared secret as server expects).
- [ ] Confirm you have a rollback point for OpenClaw scripts (branch/commit or backup copy).

## 3) Freeze scheduled jobs (start of cutover window)

- [ ] Stop launchd jobs:

```bash
UID_NUM=$(id -u)
launchctl bootout gui/$UID_NUM/com.openclaw.xmonitor.priority || true
launchctl bootout gui/$UID_NUM/com.openclaw.xmonitor.discovery || true
```

- [ ] Confirm no scheduled dispatcher run is still active before snapshot/export/import.

## 4) Snapshot + export (authoritative local backup)

- [ ] Create immutable SQLite snapshot:

```bash
TS=$(date +%Y%m%d_%H%M%S)
SNAPSHOT="data/x_monitor.cutover.${TS}.db"
cp /Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db "$SNAPSHOT"
sqlite3 "$SNAPSHOT" "PRAGMA integrity_check;"
echo "$SNAPSHOT"
```

- [ ] Export snapshot to JSONL:

```bash
EXPORT_DIR="data/export_cutover_${TS}"
python3 scripts/migrate/export_sqlite.py \
  --sqlite-path "$SNAPSHOT" \
  --out-dir "$EXPORT_DIR"
echo "$EXPORT_DIR"
```

## 5) Import to Postgres (one-time resync during freeze)

- [ ] Run import and capture rejects:

```bash
REJECT_LOG="data/import_rejects_cutover_${TS}.ndjson"
DATABASE_URL='postgres://user:pass@host:5432/xmonitor' \
python3 scripts/migrate/import_sqlite_jsonl_to_postgres.py \
  --input-dir "$EXPORT_DIR" \
  --reject-log "$REJECT_LOG"
echo "$REJECT_LOG"
```

- [ ] If reject log is non-empty, classify each row and decide:
  - data-shape bug (fix importer and rerun),
  - expected drop (document as intentional),
  - source data issue (clean in source and rerun).

## 6) Validate counts + spot checks (hard gate)

- [ ] Run parity validator (counts + random post field checks):

```bash
DATABASE_URL='postgres://user:pass@host:5432/xmonitor' \
python3 scripts/migrate/validate_counts.py \
  --sqlite-path "$SNAPSHOT" \
  --sample-size 50
```

- [ ] Gate rule for proceeding:
  - exit code `0` and no missing/mismatch rows in output.
  - if exit code `2`, investigate and resolve before proceeding.

- [ ] Manual spot checks (minimum 5 recent status IDs):
  - pick IDs from snapshot (`tweets.status_id`),
  - verify each exists in hosted detail route (`/api/v1/posts/{statusId}`),
  - verify body text is expected (reply-prefix cleanup and language filters preserved).

## 7) Deploy direct-ingest runtime (Stream B)

- [x] Deploy OpenClaw changes that remove runtime dependency on `x_monitor_sync_api.py`.
- [x] Ensure dispatcher path is capture/extract -> direct ingest API -> optional notifications.
- [x] Keep Signal disabled unless explicitly re-enabled.

Canary runs (manual):

```bash
/usr/bin/python3 /Users/paulbrigner/.openclaw/workspace/scripts/x_monitor_dispatch.py \
  --mode priority --disable-signal-send

/usr/bin/python3 /Users/paulbrigner/.openclaw/workspace/scripts/x_monitor_dispatch.py \
  --mode discovery --disable-signal-send
```

- [x] Verify both canaries write fresh records visible in hosted feed/detail.

## 8) Re-enable scheduler + monitor first cycles

- [ ] Re-enable launchd jobs:

```bash
UID_NUM=$(id -u)
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.openclaw.xmonitor.priority.plist
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.openclaw.xmonitor.discovery.plist
launchctl enable gui/$UID_NUM/com.openclaw.xmonitor.priority
launchctl enable gui/$UID_NUM/com.openclaw.xmonitor.discovery
```

- [ ] Monitor first 3-5 cycles:
  - no ingest auth failures,
  - no SQLite-lock dependency failures,
  - feed freshness matches expected schedule.

- [ ] Save evidence:
  - cutover timestamp,
  - last pre-cutover and first post-cutover run IDs,
  - reject count from import,
  - validation report output.

## 9) Decommission criteria (after stability period, e.g. 48h)

- [x] `x_monitor_sync_api.py` is no longer in active runtime path.
- [ ] local SQLite is no longer required for correctness (archive snapshot retained only).
- [x] operational checks are based on API/DB health metrics and ingest success (health endpoint, ingest failure threshold alerting, daily reconciliation).
- [ ] update docs to mark transition complete (`AWS_MIGRATION_RUNBOOK.md`, `DIRECT_INGEST_API_TRANSITION_PLAN.md`, and OpenClaw runtime notes).

## 10) Rollback playbook (if cutover fails)

- [ ] Stop launchd jobs immediately.
- [ ] Revert OpenClaw dispatcher/runtime to previous known-good SQLite+sync commit.
- [ ] Re-enable launchd jobs on old path.
- [ ] If necessary, rerun one-time import from archived snapshot to restore cloud parity.
- [ ] Capture incident notes and root-cause before next cutover attempt.

## 11) Sign-off template

Use this exact record in your cutover notes:

- Cutover date/time (ET):
- Operator:
- Snapshot file:
- Export directory:
- Reject log path:
- Reject row count:
- Validator exit code:
- Spot check pass/fail:
- Canary pass/fail:
- First stable scheduled run timestamp:
- Rollback required (yes/no):
