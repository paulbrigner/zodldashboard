# X Monitor Capture Pipeline And Tuning

Last updated: 2026-03-01 (America/New_York)

## Purpose

This document explains how local X capture works for X Monitor, what it depends on, how paging/scroll capture behaves, and how it is currently tuned.

## Runtime Components

### Launchd jobs

- `~/Library/LaunchAgents/com.openclaw.xmonitor.priority.plist`
- `~/Library/LaunchAgents/com.openclaw.xmonitor.discovery.plist`
- `~/Library/LaunchAgents/com.openclaw.xmonitor.reconcile.plist`

### Scripts

- Dispatcher: `/Users/paulbrigner/.openclaw/workspace/scripts/x_monitor_dispatch.py`
- Capture + parse + local KB: `/Users/paulbrigner/.openclaw/workspace/scripts/x_monitor_kb.py`
- Ingest to hosted API: `/Users/paulbrigner/.openclaw/workspace/scripts/x_monitor_ingest_api.py`
- Reconcile counts: `/Users/paulbrigner/.openclaw/workspace/scripts/x_monitor_reconcile.py`

### Storage

- Local SQLite KB: `/Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db`
- Hosted API target: `https://www.zodldashboard.com/api/v1` (via ingest script)

## High-Level Flow

1. Launchd triggers `x_monitor_dispatch.py` by schedule.
2. Dispatcher invokes `x_monitor_kb.py run --mode <priority|discovery>`.
3. `x_monitor_kb.py` builds X queries from watchlists/keywords.
4. For each query, it captures snapshots from X, parses posts, deduplicates by `status_id`, scores significance, upserts SQLite, updates embeddings.
5. Dispatcher runs `x_monitor_ingest_api.py` to upsert local deltas to hosted API.
6. UI reads from hosted API feed endpoints.

## Browser Capture Dependency

Capture currently uses OpenClaw CLI browser tooling:

- `openclaw browser ... open`
- `openclaw browser ... wait`
- `openclaw browser ... snapshot --format ai`
- `openclaw browser ... evaluate` (for scroll step)
- `openclaw browser ... close`

Important: this does not use an LLM for snapshot generation. It is OpenClaw browser tooling producing an AI-friendly textual snapshot format.

## What A Snapshot Contains

- Snapshot reflects the currently loaded/rendered portion of the page.
- It is not a full feed export.
- X results are infinite scroll; more content loads only after scroll and wait.

## Current Paging/Scroll Behavior

`x_monitor_kb.py` now uses multi-step query capture (`browser_query_articles`):

1. Open X search URL for query.
2. Wait for initial render.
3. Snapshot and parse articles.
4. Scroll by configured pixels.
5. Wait for additional load.
6. Snapshot again and merge unique posts by `status_id`.
7. Repeat until stop condition.

## Stop Conditions

Capture stops when either condition is met:

1. `XMON_CAPTURE_SCROLL_MAX_STEPS` is reached.
2. No new `status_id` values are found for `XMON_CAPTURE_SCROLL_STOP_NO_NEW_STEPS` consecutive scroll snapshots.

This means overlap with already seen posts is normal; capture stops early only when a whole step yields no new IDs (for the configured consecutive count).

## Active Tuning (Applied)

Configured in both `priority` and `discovery` launchd job `EnvironmentVariables`:

- `XMON_CAPTURE_SCROLL_ENABLED=1`
- `XMON_CAPTURE_SCROLL_MAX_STEPS=10`
- `XMON_CAPTURE_SCROLL_WAIT_MS=3000`
- `XMON_CAPTURE_SCROLL_PX=2200`
- `XMON_CAPTURE_SCROLL_STOP_NO_NEW_STEPS=2`

Interpretation:

- Up to 10 scroll cycles per query.
- 3 seconds wait after each scroll to allow lazy-loaded posts to render.
- 2200px scroll increments.
- Early-stop requires two consecutive no-new-id snapshots.

## Parsing Notes

### Article extraction

- Posts are parsed from OpenClaw AI snapshot article blocks.
- `status_id` is extracted from `/.../status/<id>` URL lines.
- Engagement fields (`likes/reposts/replies/views`) are parsed from action/group text.
- Dedup is by `status_id`; higher-engagement version wins.

### Text extraction hardening

Recent fixes include:

- Quote-card safety to prevent older quoted text replacing new post text.
- Guardrails against author-label-only captures.
- Media-tail cleanup for title-derived text.

## Auth/Key Dependency Notes

For embeddings/summaries, key resolution in `x_monitor_kb.py` is:

1. Use explicit env vars if set (`XMON_EMBED_API_KEY`, `XMON_SUMMARY_LLM_API_KEY`).
2. Fallback to OpenClaw auth profiles file lookup when env keys are absent.

This means auth dependency can be eliminated by setting explicit env keys and removing fallback code.

## Operational Commands

### Check jobs

```bash
launchctl list | rg 'com\.openclaw\.xmonitor\.(priority|discovery|reconcile)'
```

### Pause/resume jobs

```bash
# Pause
launchctl bootout gui/501/com.openclaw.xmonitor.priority
launchctl bootout gui/501/com.openclaw.xmonitor.discovery

# Resume
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.openclaw.xmonitor.priority.plist
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.openclaw.xmonitor.discovery.plist
```

### Dry sanity run

```bash
/usr/bin/python3 /Users/paulbrigner/.openclaw/workspace/scripts/x_monitor_kb.py \
  --db /Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db \
  run --mode priority --profile openclaw --max-items 5
```

## Known Limits

- Capture completeness is still heuristic, not guaranteed full pagination.
- X rendering/login/challenge changes can affect extraction quality.
- Larger scroll settings increase runtime and browser load.

## Recommended Monitoring

- Watch dispatcher logs for per-query capture metrics:
  - `unique_articles`
  - `scroll_steps`
- Periodically compare expected high-volume handles against captured counts.
- If missed posts are observed, increase `XMON_CAPTURE_SCROLL_MAX_STEPS` and/or `XMON_CAPTURE_SCROLL_WAIT_MS`.
