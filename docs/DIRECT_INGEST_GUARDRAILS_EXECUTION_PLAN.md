# Direct Ingest Guardrails - Execution Plan

_Last updated: 2026-02-26 (ET)_

## Purpose

Add operational guardrails now, while deferring the larger "remove local SQLite correctness dependency" refactor.

## Scope

- In scope: reliability guardrails for current direct-ingest runtime.
- Out of scope: moving significance/dedupe/report ownership fully to API in this pass.

## Current baseline

- Active runtime path: `x_monitor_dispatch.py -> x_monitor_ingest_api.py`.
- Local SQLite remains the collector-side state/scoring store.
- Hosted API is healthy and ingest auth is enforced.

## Guardrail package

1. Wider catch-up ingest window per run.
2. Alert on consecutive ingest failures.
3. Daily reconciliation (local SQLite vs hosted API counts).
4. Explicit outage recovery procedure.

## Execution status (2026-02-25/26 ET)

- [x] G1 completed: launchd env hardened (`lookback=900`, retries/backoff set) and verified in dispatcher logs.
- [x] G2 completed: failure state persisted to `~/.openclaw/workspace/memory/x_monitor_ingest_health.json`; threshold alert validated with two forced failures; success reset validated.
- [x] G3 completed: protected backend route `GET /v1/ops/reconcile-counts` deployed, reconciliation script installed, and daily LaunchAgent configured (`com.openclaw.xmonitor.reconcile`, 05:10 ET).
- [x] G4 completed: recovery command and post-recovery checks documented in this plan and runbook.
- [ ] G5 pending: 30-day observe-and-decide checkpoint.

Evidence snapshot:
- Backend reconcile route returns `401` without auth and `200` with ingest secret.
- Reconcile LaunchAgent kickstart result: `reconcile PASS` with zero deltas across posts/reports/pipeline_runs/window_summaries/narrative_shifts.
- Failure drill emitted deterministic alert line:
  - `ALERT: ingest failures threshold reached mode=priority consecutive_failures=2 threshold=2 ...`

## Phase G1 - Catch-up window hardening (same day)

### Changes

- Set/confirm ingest overlap window to 15 minutes (900 seconds).
- Keep bounded retry/backoff enabled.

### Commands

```bash
launchctl setenv XMONITOR_INGEST_LOOKBACK_SECONDS 900
launchctl setenv XMONITOR_INGEST_MAX_ATTEMPTS 4
launchctl setenv XMONITOR_INGEST_INITIAL_BACKOFF_SECONDS 1
```

```bash
UID_NUM=$(id -u)
launchctl kickstart -k gui/$UID_NUM/com.openclaw.xmonitor.priority
launchctl kickstart -k gui/$UID_NUM/com.openclaw.xmonitor.discovery
```

### Verification

- Priority/discovery logs show ingest invocation with `--lookback-seconds 900`.
- No auth errors; `api ingest ok` appears for successful cycles.

### Owner

- Stream B (OpenClaw runtime).

## Phase G2 - Consecutive failure alerting (1-2 days)

### Changes

- Extend dispatcher to persist ingest health state:
  - file: `~/.openclaw/workspace/memory/x_monitor_ingest_health.json`
  - fields: `consecutive_failures_by_mode`, `last_success_at`, `last_failure_at`, `last_error`.
- Add failure threshold control:
  - env/flag: `XMONITOR_INGEST_FAILURE_ALERT_THRESHOLD` (default `2`).
- Add one-shot alert sink on threshold breach:
  - default: log `ALERT` line to dispatcher log.
  - optional: execute `XMONITOR_ALERT_CMD` if configured.

### Validation drill

```bash
/usr/bin/python3 ~/.openclaw/workspace/scripts/x_monitor_dispatch.py \
  --mode priority \
  --api-base-url https://127.0.0.1:9 \
  --disable-signal-send
```

Run the drill twice and confirm threshold alert triggers once.

### Exit criteria

- Two consecutive ingest failures in same mode produce deterministic alert event.
- First successful run resets that mode's failure counter.

### Owner

- Stream B (OpenClaw runtime).

## Phase G3 - Daily reconciliation (2-4 days)

### Changes

- Stream A: add a lightweight protected ops endpoint for counts by time window (24h default):
  - `GET /v1/ops/reconcile-counts?since=<iso>`
  - response includes counts for `posts`, `reports`, `pipeline_runs`, `window_summaries`, `narrative_shifts`.
  - auth: same shared-secret model as ingest routes.
- Stream B: add reconciliation script:
  - `~/.openclaw/workspace/scripts/x_monitor_reconcile.py`
  - compares local SQLite counts vs API counts for same window.
  - emits pass/fail summary and non-zero exit on threshold breach.

### Scheduler

- Add daily launchd job (example 05:10 ET) writing to:
  - `~/.openclaw/workspace/logs/xmonitor-reconcile.log`

### Suggested thresholds

- posts delta tolerance: `<= 3` for trailing 24h.
- reports/runs delta tolerance: `0`.
- summaries/shift tolerance: `0` at aligned windows.

### Exit criteria

- Reconciliation runs daily for 7 days with no unresolved mismatches.
- Any mismatch is logged with concrete IDs/time-window for replay.

### Owner

- Stream A + Stream B.

## Phase G4 - Outage recovery runbook (same day after G3)

### Manual recovery command

Replay from outage start (with overlap):

```bash
python3 ~/.openclaw/workspace/scripts/x_monitor_ingest_api.py \
  --db ~/.openclaw/workspace/memory/x_monitor.db \
  --api-base-url https://www.zodldashboard.com/api/v1 \
  --api-key "$XMONITOR_API_KEY" \
  --since "<outage_start_utc_iso>" \
  --lookback-seconds 3600 \
  --max-attempts 5
```

### Post-recovery checks

- `GET /api/v1/health` returns DB `ok`.
- Feed shows expected freshness.
- Reconciliation run passes for outage window.

### Owner

- Stream B operations.

## Phase G5 - 30-day observe-and-decide checkpoint

Run this checkpoint 30 days after G1.

Decision metrics:

- ingest failure incidents per week.
- number of manual recoveries required.
- reconciliation mismatch rate.
- time-to-detect and time-to-recover.

If metrics are acceptable:

- keep guardrail model and defer full migration.

If metrics are not acceptable:

- start full migration (API-owned significance/state, local cache-only mode).

## Revisit full migration notes

Revisit full migration immediately if any of these happen:

- repeated SQLite lock/contention impacts despite guardrails.
- frequent replay/recovery operations (>2 per month).
- need multi-collector ingest with shared consistency rules.
- need server-auditable significance/report decisions.

Target future architecture when revisited:

- collector sends raw extracted posts/metrics only;
- API owns dedupe/significance/report transitions;
- local storage becomes optional cache/spool, not correctness-critical.

## Suggested implementation order

1. G1 (config hardening)
2. G2 (failure alerting)
3. G3 (daily reconciliation)
4. G4 (runbook finalization)
5. G5 checkpoint date entry in ops calendar
