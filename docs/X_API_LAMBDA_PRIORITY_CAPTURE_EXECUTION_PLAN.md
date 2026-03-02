# X API Lambda Cutover Plan (Priority + Watchlist Replies)

Last updated: 2026-03-02 (America/New_York)

> Status: Historical implementation plan. Priority and discovery capture are now both AWS-side. Use `docs/AWS_MIGRATION_RUNBOOK.md` and `docs/X_MONITOR_X_QUERY_AND_WATCHLIST_REFERENCE.md` for current-state behavior.

## 1) Goal and scope

Move **priority + watchlist reply capture** from local browser scraping to a scheduled AWS Lambda that uses the X API and ingests directly to the existing hosted ingest routes.

In scope:
- Priority capture from watchlist handles
- Reply capture from watchlist handles (`term_constrained` or `selected_handles`)
- Direct ingest to:
  - `POST /v1/ingest/posts/batch`
  - `POST /v1/ingest/embeddings/batch` (Venice embedding parity for newly inserted posts)
  - `POST /v1/ingest/runs`

Out of scope:
- Discovery keyword capture migration
- Summary generation migration
- Local SQLite retirement for all collector behaviors

## 2) Rollback design

Rollback is switch-based and does not require code revert:

- AWS collector off:
  - Disable EventBridge rule OR set `XMON_COLLECTOR_ENABLED=false`
- Local collector on:
  - Re-bootstrap `com.openclaw.xmonitor.priority` launchd job

This keeps one-command fallback available.

## 3) New implementation (repo)

- Collector Lambda code:
  - `services/x-api-collector-lambda/index.mjs`
- Collector Lambda package:
  - `services/x-api-collector-lambda/package.json`
- Provision script:
  - `scripts/aws/provision_x_api_collector_lambda.sh`

## 4) Required credentials and config

Required at deploy time:
- `X_API_BEARER_TOKEN` (X API bearer token)
- `INGEST_API_KEY` (same ingest shared secret used by hosted API)

Optional but recommended:
- Store `x_api_bearer_token` in `xmonitor/rds/app` secret payload for script fallback.
- Or pass `X_API_CONSUMER_KEY` + `X_API_CONSUMER_SECRET` and let the provision script mint a fresh bearer token.

## 5) Deployment checklist (executable)

1. Confirm AWS auth/session:

```bash
aws --profile zodldashboard --region us-east-1 sts get-caller-identity
```

2. Deploy collector Lambda initially in **safe shadow mode** (enabled but no writes):

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
X_API_BEARER_TOKEN='<x-bearer-token>' \
COLLECTOR_WRITE_ENABLED=false \
SCHEDULE_ENABLED=true \
./scripts/aws/provision_x_api_collector_lambda.sh
```

3. Dry-run invoke and inspect output:

```bash
aws --profile zodldashboard --region us-east-1 lambda invoke \
  --function-name xmonitor-xapi-priority-collector \
  --payload '{"dryRun":true}' \
  /tmp/xmon_xapi_collector_dryrun.json

cat /tmp/xmon_xapi_collector_dryrun.json
```

4. Validate CloudWatch logs for query/page counts and skip reasons.

5. Cutover write path:
   - Pause local priority collector launchd job.
   - Enable Lambda writes.

```bash
UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/com.openclaw.xmonitor.priority" || true

AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
X_API_BEARER_TOKEN='<x-bearer-token>' \
COLLECTOR_WRITE_ENABLED=true \
SCHEDULE_ENABLED=true \
./scripts/aws/provision_x_api_collector_lambda.sh
```

6. Validate production ingest:
- Feed freshness in UI
- New run rows with `mode=priority` and `source=aws-lambda-x-api`
- No unexpected drop in captured watchlist posts

7. Keep discovery mode local unless/until separately migrated.

## 6) Rollback checklist (executable)

1. Disable AWS collector schedule:

```bash
aws --profile zodldashboard --region us-east-1 events disable-rule \
  --name xmonitor-xapi-priority-collector-15m
```

2. Re-enable local priority launchd collector:

```bash
UID_NUM="$(id -u)"
launchctl bootstrap "gui/$UID_NUM" "$HOME/Library/LaunchAgents/com.openclaw.xmonitor.priority.plist"
launchctl enable "gui/$UID_NUM/com.openclaw.xmonitor.priority"
launchctl kickstart -k "gui/$UID_NUM/com.openclaw.xmonitor.priority"
```

3. Verify local dispatcher logs show normal ingest success.

## 7) Suggested initial runtime defaults

- `SCHEDULE_EXPRESSION=rate(15 minutes)`
- `X_API_MAX_PAGES_PER_QUERY=2`
- `X_API_MAX_RESULTS_PER_QUERY=100`
- `X_API_REPLY_CAPTURE_ENABLED=true`
- `X_API_REPLY_MODE=term_constrained`
- `X_API_ENFORCE_LANG_ALLOWLIST=true`
- `X_API_LANG_ALLOWLIST=en`
- `X_API_HANDLE_CHUNK_SIZE=16`

## 8) Risks and mitigations

Risk: query cost/volume increases with reply capture.
Mitigation: keep low page cap (`2`), observe usage, increase gradually.

Risk: missing posts due X API recency/page limits.
Mitigation: shorter schedule interval, chunked watchlist queries, monitor run counters.

Risk: accidental dual writers (local + lambda).
Mitigation: pause local priority launchd before enabling Lambda writes.

## 9) Post-cutover observability

Track these counters per run from Lambda output:
- `rawTweets`
- `uniqueTweets`
- `skippedLang`
- `skippedNonWatchlist`
- `queryCount`
- `pageCount`

Compare against historical local priority run envelope to verify parity.
