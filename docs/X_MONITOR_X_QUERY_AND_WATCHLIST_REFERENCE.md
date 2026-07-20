# X Monitor — X Query + Watchlist Reference (AWS Collector)

_Last updated: 2026-07-20 (ET)_

This document describes the query logic currently used by the AWS X API collectors.

## Source of truth

- Collector implementation:
  `services/x-api-collector-lambda/index.mjs`
- Provisioning/env wiring:
  - `scripts/aws/provision_x_api_collector_lambda.sh`
  - `scripts/aws/provision_x_api_discovery_collector_lambda.sh`

## 1) Active collector modes

- `priority` mode:
  - Zodl Team and ecosystem watchlist posts
  - influencer watchlist posts using base terms
  - watchlist Article capture
  - optional watchlist reply capture
- `discovery` mode:
  - broad base-term discovery only
  - no reply-capture path by default
  - rolling summary generation (`rolling_2h`, `rolling_12h`, `rolling_7d_daily`)

Event schedules (default):
- priority: `rate(15 minutes)`
- discovery: `rate(30 minutes)`

## 2) Base terms and query families

Priority/reply base terms:

```text
Zcash OR ZEC OR Zodl
```

Discovery base terms:

```text
Zcash OR Zodl
```

### Priority direct watchlist query family (`source_query=priority`)

For Zodl Team (`teammate`) and ecosystem handle chunks:

```text
(from:<handle1> OR from:<handle2> OR ... ) -is:retweet
```

(`-is:quote` is optional via env and defaults to off)

### Priority influencer query family (`source_query=priority`)

For each handle chunk:

```text
(from:<handle1> OR from:<handle2> OR ... ) (<base_terms>) -is:reply -is:retweet
```

(`-is:quote` is optional via env and defaults to off)

### Priority Article query family (`source_query=priority_article`)

For all watchlist handle chunks:

```text
(from:<handle1> OR from:<handle2> OR ... ) has:links -is:retweet
```

The collector keeps only X Article posts from this lane, then stores the article title plus canonical Article URL.

### Priority reply query family

Current priority-collector reply settings:
- `XMON_X_API_REPLY_CAPTURE_ENABLED=true`
- `XMON_X_API_REPLY_MODE=term_constrained`
- `XMON_X_API_REPLY_TIERS=teammate,influencer,ecosystem`

Active reply query (`source_query=priority_reply_term`):

```text
(from:<handles...>) is:reply (<base_terms>) -is:retweet
```

Note:
- Zodl Team and ecosystem handles are excluded from reply-specific lanes because they are already captured by direct watchlist queries (including replies)
- this reduces overlap without reducing Zodl Team or ecosystem reply coverage

### Discovery query family (`source_query=discovery`)

```text
(Zcash OR Zodl) -is:retweet
```

(`-is:quote` is optional via env and defaults to off)

## 3) Filtering and quality gates

Applied in collector runtime before ingest:

1. Lang allowlist gate:
   - `XMON_X_API_ENFORCE_LANG_ALLOWLIST=true`
   - `XMON_X_API_LANG_ALLOWLIST=en`
   - X Article posts are exempt because the X API may mark them as `zxx`
2. Omit-handle gate:
   - `XMONITOR_INGEST_OMIT_HANDLES`
   - applies to keyword/discovery-origin posts
   - watchlist-tier posts are preserved
3. Base-term relevance gate:
   - requires configured Zcash base terms for discovery posts and base-term-constrained priority families
   - X Article posts are exempt and are treated as significant when authored by watchlist accounts
4. Empty/stub hard reject:
   - drops empty, URL-only, or media-stub posts before ingest
   - X Article posts use the article title plus article URL as their stored text
5. Async significance classification:
   - accepted posts are ingested as `classification_status=pending`
   - a separate scheduled classifier assigns `is_significant` and reason labels after ingest
   - X Article posts are ingested as `classification_status=classified`, `is_significant=true`

## 4) Watchlist defaults in collector code

Current active tier buckets:
- `teammate` (displayed as **Zodl Team**)
- `influencer`
- `ecosystem`

The `investor` tier remains accepted by the database and API for legacy compatibility, but it has no active default
watchlist mappings. Former investor accounts are now influencers, except `cypherpunk`, which is an ecosystem account.

The handle lists change over time, so the source of truth is the collector code in
`services/x-api-collector-lambda/index.mjs` and the mirrored in-app Query Reference.
As of 2026-07-20, the Zodl Team bucket has 18 handles, the influencer bucket has 55 handles, and the ecosystem
bucket has 10 handles. The ecosystem bucket includes `cypherpunk`, `tachyonzcash`, and `valargroup`.

## 5) Paging and request tuning

Key env controls:
- `XMON_X_API_MAX_RESULTS_PER_QUERY` (default `100`)
- `XMON_X_API_MAX_PAGES_PER_QUERY` (default `2`)
- `XMON_X_API_HANDLE_CHUNK_SIZE` (default `16`)
- `XMON_X_API_SINCE_ID_ENABLED` (default `true`)
- `XMON_X_API_QUERY_TIMEOUT_MS` (default `15000`)
- `XMON_X_API_REQUEST_PAUSE_MS` (default `200`)

These values determine per-run query breadth and API pressure.

## 6) Embeddings and summaries

Embeddings (collector-side ingest):
- `XMON_EMBEDDING_ENABLED=true`
- default model `text-embedding-bge-m3`
- ingest route: `/ingest/embeddings/batch`

Summaries (discovery mode):
- `XMON_SUMMARY_ENABLED=true`
- aligned windows every `XMON_SUMMARY_ALIGN_HOURS` (default `2`)
- weekly summary generated daily at `6:00 AM America/New_York`
- LLM defaults:
  - backend: `auto`
  - model: `openai-gpt-56-terra-pro`
  - max tokens: `900`
  - timeout: `180000 ms`
- narrative inputs: representative posts, active voices, and theme signals; preset debate categories are excluded
- fallback behavior: if narrative synthesis fails, collector emits stats-style summary text.

## 7) Quick verification commands

Manual invoke:

```bash
aws --profile zodldashboard --region us-east-1 lambda invoke \
  --function-name xmonitor-xapi-priority-collector \
  --payload '{"source":"manual","mode":"priority"}' \
  /tmp/xmon-priority.json && cat /tmp/xmon-priority.json
```

Check latest records through the direct backend. These read routes require the
server-only client credential; `/health` remains unsigned. The dashboard
`/api/v1` BFF is for browsers with an authenticated viewer session.

```bash
read_api_base="${XMONITOR_BACKEND_API_BASE_URL:?set the direct backend base URL}"
curl -sS "$read_api_base/health"
curl -sS \
  -H "x-xmonitor-client-id: ${XMONITOR_READ_CLIENT_ID:?set the read client ID}" \
  -H "x-xmonitor-client-secret: ${XMONITOR_READ_CLIENT_SECRET:?set the read client secret}" \
  "$read_api_base/feed?limit=5"
curl -sS \
  -H "x-xmonitor-client-id: $XMONITOR_READ_CLIENT_ID" \
  -H "x-xmonitor-client-secret: $XMONITOR_READ_CLIENT_SECRET" \
  "$read_api_base/window-summaries/latest"
```
