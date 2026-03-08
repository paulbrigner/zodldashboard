# X Monitor Capture Pipeline and Tuning (AWS X API)

Last updated: 2026-03-02 (America/New_York)

## Purpose

This document describes the active capture/ingest pipeline, quality gates, and tuning controls now that capture runs server-side via X API.

## Runtime components (active path)

- Priority collector Lambda:
  `xmonitor-xapi-priority-collector`
- Discovery collector Lambda:
  `xmonitor-xapi-discovery-collector`
- Collector code:
  `/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/zodldashboard/services/x-api-collector-lambda/index.mjs`
- Provisioning scripts:
  - `/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/zodldashboard/scripts/aws/provision_x_api_collector_lambda.sh`
  - `/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/zodldashboard/scripts/aws/provision_x_api_discovery_collector_lambda.sh`
- Ingest API:
  `https://www.zodldashboard.com/api/v1/ingest/*` (proxied to backend `/v1/ingest/*`)
- Data store:
  RDS PostgreSQL (system of record)

## High-level flow

1. EventBridge triggers collector Lambda.
2. Collector builds X API query plan based on mode (`priority` or `discovery`).
3. Collector fetches and normalizes X posts.
4. Collector applies gates:
   - language allowlist
   - discovery-noise rejection
   - omit handles
   - significance scoring
5. Collector ingests:
   - posts (`/ingest/posts/batch`)
   - embeddings (`/ingest/embeddings/batch`, when enabled)
   - run telemetry (`/ingest/runs`)
6. Discovery collector also computes and ingests rolling summaries (`/ingest/window-summaries/batch`).

## Capture model

There is no browser snapshot scraping in the active path.

Capture is API-native:
- X API search pages are fetched directly.
- Pagination is controlled by `next_token`.
- Query breadth is bounded by `max_results` and `max_pages`.

This removes prior fragility from HTML/rendering/snapshot parsing and browser-tab lifecycle issues.

## Query and pagination tuning

Primary controls:
- `XMON_X_API_MAX_RESULTS_PER_QUERY` (default `100`)
- `XMON_X_API_MAX_PAGES_PER_QUERY` (default `2`)
- `XMON_X_API_HANDLE_CHUNK_SIZE` (default `16`)
- `XMON_X_API_SINCE_ID_ENABLED` (default `true`)
- `XMON_X_API_QUERY_TIMEOUT_MS` (default `15000`)
- `XMON_X_API_REQUEST_PAUSE_MS` (default `200`)

Operational guidance:
- Increase `MAX_PAGES` first when post coverage appears shallow.
- Increase `MAX_RESULTS` only if needed and X API limits allow.
- Keep a pause between requests to reduce throttling risk.

## Quality controls and anti-noise protections

### Language gate

- Enabled by default (`XMON_X_API_ENFORCE_LANG_ALLOWLIST=true`)
- Default allowlist: `en` (`XMON_X_API_LANG_ALLOWLIST=en`)

### Omit-handle gate

- Controlled by `XMONITOR_INGEST_OMIT_HANDLES`
- Intended to suppress persistent noisy keyword/discovery accounts
- Watchlist-tier posts are not removed by omit-handle filtering

### Discovery noise gate

Discovery mode rejects common spam/signal patterns, including:
- "trading signals" style promo text
- high-density cashtag/hashtag blasts
- TP/accuracy/VIP/Telegram signal patterns

Rejected posts are tagged with `discovery_noise:*` style reasons in run diagnostics.

### Significance scoring

`is_significant` is derived from:
- watchlist tier presence
- text substance thresholds
- material keyword matches
- engagement thresholds
- spam/low-signal guards

TODO: remove engagement thresholds from significance classification because captured metrics are
not a reliable measure of post engagement over time in the current pipeline.

## Embeddings and summary generation

### Embeddings

- Controlled by `XMON_EMBEDDING_ENABLED` (default `true`)
- Default model: `text-embedding-bge-m3`
- Collector can batch and cap embedding writes per run

### Rolling summaries

- Enabled by `XMON_SUMMARY_ENABLED` (default `true`)
- Generated in discovery mode on aligned windows:
  - `rolling_2h`
  - `rolling_12h`
- Narrative synthesis uses configured summary LLM settings.
- If synthesis fails/timeouts/truncates after retries, collector falls back to stats-style summary text.

Key summary tuning:
- `XMON_SUMMARY_LLM_MODEL` (default `zai-org-glm-5`)
- `XMON_SUMMARY_LLM_MAX_TOKENS` (default `900`)
- `XMON_SUMMARY_LLM_TIMEOUT_MS` (default `180000`)
- `XMON_SUMMARY_LLM_MAX_ATTEMPTS` (default `3`)
- `XMON_SUMMARY_LLM_INITIAL_BACKOFF_MS` (default `1000`)

## Monitoring commands

Collector rule status:

```bash
aws --profile zodldashboard --region us-east-1 events describe-rule \
  --name xmonitor-xapi-priority-collector-15m \
  --query '{State:State,ScheduleExpression:ScheduleExpression}'
aws --profile zodldashboard --region us-east-1 events describe-rule \
  --name xmonitor-xapi-discovery-collector-30m \
  --query '{State:State,ScheduleExpression:ScheduleExpression}'
```

Tail logs:

```bash
aws --profile zodldashboard --region us-east-1 logs tail \
  '/aws/lambda/xmonitor-xapi-priority-collector' --since 2h --follow
aws --profile zodldashboard --region us-east-1 logs tail \
  '/aws/lambda/xmonitor-xapi-discovery-collector' --since 2h --follow
```

Manual invoke:

```bash
aws --profile zodldashboard --region us-east-1 lambda invoke \
  --function-name xmonitor-xapi-priority-collector \
  --payload '{"source":"manual","mode":"priority"}' \
  /tmp/xmon-priority.json && cat /tmp/xmon-priority.json
```

## Legacy local capture notes

The previous local OpenClaw browser-snapshot capture path is no longer the active production ingest path.

If local rollback is required temporarily:
- disable AWS collector rules first,
- ensure only one writer path is active per mode,
- treat local launchd runtime as emergency fallback, not steady state.
