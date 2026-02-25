# XMonitor Direct Ingest-to-API Transition Plan

_Last updated: 2026-02-25 (ET)_

## Purpose
Define how to move from the current **local SQLite + API sync** architecture to a **direct ingest-to-API** architecture where AWS is the only persistent system of record.

This document is a transition plan only (no code changes implied by this doc).

## Decision update (2026-02-25)
- Direct ingest cutover is now the preferred prerequisite before semantic/NL search implementation.
- Rationale: semantic retrieval quality depends on corpus freshness; SQLite->API sync lag/drift introduces avoidable relevance and correctness risk.
- Operational intent: move to one durable source of truth (AWS) and keep only lightweight local buffering for outage tolerance.

---

## 1) Current state (as of today)

### Runtime components
- Local collector/scoring script: `~/.openclaw/workspace/scripts/x_monitor_kb.py`
- Local scheduler/dispatcher: `~/.openclaw/workspace/scripts/x_monitor_dispatch.py`
- Local API sync: `~/.openclaw/workspace/scripts/x_monitor_sync_api.py`
- Local DB: `~/.openclaw/workspace/memory/x_monitor.db`
- LaunchAgents:
  - `com.openclaw.xmonitor.priority`
  - `com.openclaw.xmonitor.discovery`

### Current flow
1. Dispatcher runs local `x_monitor_kb.py`.
2. Script writes/reads local SQLite for dedupe, watchlists, significance, reports, and 24h refresh.
3. Dispatcher then runs `x_monitor_sync_api.py` to push deltas to API.
4. Signal updates are sent from dispatcher when there is output.

### Current pain points
- Duplicate persistence layers (SQLite + cloud API data store).
- SQLite lock contention (`database is locked`) under overlapping operations.
- Sync lag/drift risk between local and cloud.
- Extra complexity while web dashboard is becoming the primary UX.

---

## 2) Target state

## Target architecture
- Local process only handles **X capture / extraction**.
- All durable state moves to AWS:
  - posts,
  - metrics snapshots,
  - watchlist tiering,
  - significance flags,
  - report state,
  - run logs,
  - embeddings.
- Dashboard reads directly from AWS DB/API.
- Signal delivery becomes optional or removed.

## Design principle
**API-first write path**: local collector emits events directly to AWS ingest API; no local DB dependency for correctness.

---

## 3) Transition strategy

Use a staged cutover with a short controlled freeze. No long dual-write phase required.

### Phase 0 — Preconditions (AWS readiness)
Required before touching local pipeline:
- Postgres schema live in AWS.
- Ingest/query API endpoints live and tested.
- One-time historical migration completed.
- Dashboard can read migrated data.

Exit criteria:
- `/health` OK
- ingest endpoints pass idempotency tests
- feed endpoint returns migrated records

---

### Phase 1 — Introduce direct-ingest client (local)
Build a new local module/script (recommended new file):
- `x_monitor_ingest_api.py`

Responsibilities:
- Send post batches to `/ingest/posts/batch`
- Send metric snapshots to `/ingest/metrics/batch`
- Send report marks to `/ingest/reports/batch`
- Send run telemetry to `/ingest/runs`
- Prepare extension point for embeddings batch writes once `/ingest/embeddings/batch` is available.

Important behavior:
- Idempotent retries with bounded backoff.
- Per-batch success/failure accounting in logs.
- Hard fail visibility (non-zero exit) if API unavailable.

No SQLite writes should be required in this phase if API logic is complete.

---

### Phase 2 — Move significance/state ownership to API side
This is the key architectural shift.

Decide where significance logic runs:

## Recommended (cleanest)
- API/backend owns significance + dedupe + report eligibility.
- Local collector sends extracted raw candidate posts + observed metrics.

If not feasible immediately:
- temporary hybrid where local still computes significance, but does not persist local DB.
- Still emit full payload to API and treat API as source of truth.

Required API capabilities for API-owned logic:
- Upsert candidate post with deterministic key (`status_id`)
- Server-side dedupe
- Server-side significance evaluation (same ruleset versioned, e.g. `v2`)
- Server-side report state transitions (`new -> reported`)

---

### Phase 3 — Cutover window (no dual write)

1. Pause launchd jobs.
2. Take final SQLite snapshot (for archive only).
3. Deploy local direct-ingest build.
4. Re-enable scheduler with new direct-ingest path.
5. Monitor first 3–5 cycles closely.

Freeze/restore commands (reference):
```bash
UID_NUM=$(id -u)
launchctl bootout gui/$UID_NUM/com.openclaw.xmonitor.priority || true
launchctl bootout gui/$UID_NUM/com.openclaw.xmonitor.discovery || true

# after deploy
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.openclaw.xmonitor.priority.plist
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.openclaw.xmonitor.discovery.plist
launchctl enable gui/$UID_NUM/com.openclaw.xmonitor.priority
launchctl enable gui/$UID_NUM/com.openclaw.xmonitor.discovery
```

---

### Phase 4 — Decommission local DB dependency
After cutover stability period (e.g., 48h):
- Remove `x_monitor_sync_api.py` from dispatcher path.
- Remove local SQLite read/write from runtime path.
- Keep old SQLite snapshot as archive backup only.
- Optionally keep a tiny local spool file for temporary API outage buffering.

---

## 4) Required code changes (high-level)

## Local side (Stream B)
- Refactor dispatcher so run path is:
  1) capture/extract
  2) ingest API write
  3) optional notifications
- Remove assumptions that data must exist in local SQLite before sending.
- Replace local `kb-status` with API-backed `status` command for ops.

## API side (Stream A)
- Ensure ingest endpoints support full direct payloads and are idempotent.
- Expose operator endpoint(s) for health and lag visibility.
- Add server-side versioned scoring logic if moving significance to backend.

---

## 5) Data contract for direct ingest

Minimum event payload from collector should include:
- `status_id`
- `url`
- `author_handle`, `author_display`
- `body_text`
- `captured_at` / `observed_at`
- observed metrics (`likes/reposts/replies/views`)
- source mode (`priority|discovery`)
- optional watchlist hint

API should derive:
- significance flags and reason
- dedupe/report eligibility
- run summary metrics

---

## 6) Reliability and observability requirements

At cutover, require:
- Structured logs with run IDs.
- API ingest success rate metric.
- Retry count and dead-letter/error count metric.
- Alert when 2+ consecutive scheduled cycles fail ingestion.

Recommended metrics dashboard:
- `ingest_posts_success_rate`
- `ingest_latency_ms_p95`
- `scheduler_runs_total`
- `scheduler_runs_failed`
- `records_ingested_per_run`

---

## 7) Rollback plan

If direct ingest fails after cutover:
1. Stop launchd jobs.
2. Revert to previous dispatcher build (SQLite + sync path).
3. Re-enable launchd jobs.
4. Use archived snapshot to restore local continuity if needed.

Rollback should be scriptable and documented before production cutover.

---

## 8) Definition of done

Transition is complete when:
- [ ] Scheduler runs produce data in AWS without local SQLite dependency.
- [ ] Dashboard reflects updates in near-real time from API data.
- [ ] `x_monitor_sync_api.py` is no longer part of runtime path.
- [ ] Local SQLite can be removed from active execution (retained only as archive snapshot).
- [ ] Operational health checks rely on API/DB metrics, not local DB status.
- [ ] Semantic-plan prerequisite satisfied: data freshness/correctness no longer depends on local SQLite->API migration.

---

## 9) Recommended implementation order for Codex (next step)

1. Add/confirm API idempotency + ingest completeness.
2. Implement direct-ingest local client contract (in Stream B workspace later).
3. Add pre-cutover validation checklist script.
4. Execute controlled cutover.
5. Remove sync layer and local DB runtime dependency.

---

## 10) Notes for future refinement

- If API availability becomes a concern, add a lightweight local queue (append-only JSONL spool) instead of full SQLite state.
- If team wants selective notifications, reintroduce alerts from API (not local collector) to avoid noisy coupling.
- Keep scoring logic versioned (`significance_version`) to safely evolve thresholds.

---

## 11) Dependency with semantic search plan

This transition is intentionally sequenced ahead of semantic search implementation:
- Complete this plan first to remove dual-store drift risk.
- Then execute Phase 1/2 in `OPENCLAW_NL_QUERY_PARITY_IMPLEMENTATION_PLAN.md` (pgvector + semantic endpoint).
- Keep embedding generation model-aligned with the current corpus (`Venice.AI text-embedding-bge-m3`) during semantic rollout.
