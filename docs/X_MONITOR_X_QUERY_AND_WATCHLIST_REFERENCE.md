# X Monitor — X Query + Watchlist Reference (AWS Collector)

_Last updated: 2026-03-02 (ET)_

This document describes the query logic currently used by the AWS X API collectors.

## Source of truth

- Collector implementation:
  `/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/zodldashboard/services/x-api-collector-lambda/index.mjs`
- Provisioning/env wiring:
  - `/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/zodldashboard/scripts/aws/provision_x_api_collector_lambda.sh`
  - `/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/zodldashboard/scripts/aws/provision_x_api_discovery_collector_lambda.sh`

## 1) Active collector modes

- `priority` mode:
  - watchlist posts using base terms
  - optional watchlist reply capture
- `discovery` mode:
  - broad base-term discovery only
  - no reply-capture path by default
  - rolling summary generation (`rolling_2h`, `rolling_12h`)

Event schedules (default):
- priority: `rate(15 minutes)`
- discovery: `rate(30 minutes)`

## 2) Base terms and query families

Priority/reply base terms:

```text
Zcash OR ZEC OR Zodl OR Zashi
```

Discovery base terms:

```text
Zcash OR Zodl OR Zashi
```

### Priority query family (`source_query=priority`)

For each handle chunk:

```text
(from:<handle1> OR from:<handle2> OR ... ) (<base_terms>) -is:reply -is:retweet
```

(`-is:quote` is optional via env and defaults to off)

### Priority reply query families

Controlled by:
- `XMON_X_API_REPLY_CAPTURE_ENABLED` (`true|false`)
- `XMON_X_API_REPLY_MODE` (`off|term_constrained|selected_handles`)
- `XMON_X_API_REPLY_TIERS`
- `XMON_X_API_REPLY_SELECTED_HANDLES` (used only in `selected_handles`)

`term_constrained` (`source_query=priority_reply_term`):

```text
(from:<handles...>) is:reply (<base_terms>) -is:retweet
```

Note:
- teammate/investor/ecosystem handles are excluded from reply-specific lanes because they are already captured by direct watchlist queries (including replies)
- this reduces overlap without reducing teammate/investor/ecosystem reply coverage

`selected_handles` (`source_query=priority_reply_selected`):

```text
(from:<selected_handles...>) is:reply -is:retweet
```

### Discovery query family (`source_query=discovery`)

```text
(Zcash OR Zodl OR Zashi) -is:retweet
```

(`-is:quote` is optional via env and defaults to off)

## 3) Filtering and quality gates

Applied in collector runtime before ingest:

1. Lang allowlist gate:
   - `XMON_X_API_ENFORCE_LANG_ALLOWLIST=true`
   - `XMON_X_API_LANG_ALLOWLIST=en`
2. Omit-handle gate:
   - `XMONITOR_INGEST_OMIT_HANDLES`
   - applies to keyword/discovery-origin posts
   - watchlist-tier posts are preserved
3. Base-term relevance gate:
   - requires configured Zcash base terms for discovery posts and base-term-constrained priority families
4. Empty/stub hard reject:
   - drops empty, URL-only, or media-stub posts before ingest
5. Async significance classification:
   - accepted posts are ingested as `classification_status=pending`
   - a separate scheduled classifier assigns `is_significant` and reason labels after ingest

## 4) Watchlist defaults in collector code

Total default watchlist handles: **62**

### Teammate (10)
- @bostonzcash
- @jwihart
- @lukaskorba
- @nuttycom
- @paulbrigner
- @peacemongerz
- @tonymargarit
- @txds_
- @zodl_co
- @zodl_app

### Investors (7)
- @a16zcrypto
- @cbventures
- @chapterone
- @cypherpunk
- @MaelstromFund
- @paradigm
- @winklevosscap

### Influencer (40)
- @_tomhoward
- @agzt_111
- @anonymist
- @aquietinvestor
- @arjunkhemani
- @balajis
- @banthys
- @bitlarrain
- @btcturtle
- @cipherscan_app
- @colludingnode
- @cq_elzz
- @dignitycipher
- @dismad8
- @ebfull
- @hedging_reality
- @inthepixels
- @ivydngg
- @lucidzk
- @maxdesalle
- @mert
- @mindsfiction
- @minezcash
- @nate_zec
- @naval
- @neuralunlock
- @rargulati
- @roommatemusing
- @sacha
- @seams5s
- @shieldedmoney
- @thecodebuffet
- @thortorrens
- @tipz_cash
- @valkenburgh
- @will_mcevoy
- @zcashme
- @zerodartz
- @zooko
- @zpartanll7

### Ecosystem (5)
- @genzcash
- @shieldedlabs
- @zcashcommgrants
- @zcashfoundation
- @zechub

Override options:
- `XMON_X_API_WATCHLIST_TIERS_JSON` (full map override)
- `XMON_X_API_WATCHLIST_INCLUDE_HANDLES` (subset include)

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
- LLM defaults:
  - backend: `auto`
  - model: `zai-org-glm-5`
  - max tokens: `900`
  - timeout: `180000 ms`
- fallback behavior: if narrative synthesis fails, collector emits stats-style summary text.

## 7) Quick verification commands

Manual invoke:

```bash
aws --profile zodldashboard --region us-east-1 lambda invoke \
  --function-name xmonitor-xapi-priority-collector \
  --payload '{"source":"manual","mode":"priority"}' \
  /tmp/xmon-priority.json && cat /tmp/xmon-priority.json
```

Check latest run records via API:

```bash
curl -sS 'https://www.zodldashboard.com/api/v1/feed?limit=5'
curl -sS 'https://www.zodldashboard.com/api/v1/window-summaries/latest'
```
