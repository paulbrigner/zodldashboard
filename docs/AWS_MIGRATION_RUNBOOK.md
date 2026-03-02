# XMonitor AWS Operations Runbook (Current)

_Last updated: 2026-03-02 (ET)_

This runbook describes the active production architecture and operational controls.

## 1) Current production topology

Primary write path (AWS-only):
1. EventBridge triggers scheduled collector Lambdas:
   - `xmonitor-xapi-priority-collector` (`rate(15 minutes)`)
   - `xmonitor-xapi-discovery-collector` (`rate(60 minutes)`)
2. Collector Lambda fetches X posts from X API.
3. Collector applies normalization, language/noise gates, omit-handle rules, and significance scoring.
4. Collector ingests to hosted API (`/api/v1/ingest/*`) using shared-secret auth.
5. Hosted API proxies to VPC API Lambda (`/v1/*`) and writes to RDS PostgreSQL.
6. Discovery collector also generates/ingests `rolling_2h` + `rolling_12h` summaries (aligned windows, every 2 hours UTC).

Read path:
1. Browser requests Amplify-hosted Next.js app.
2. App reads via `/api/v1/*` (or direct backend base URL when configured).
3. Backend API reads RDS and returns feed/detail/summary/query responses.

Local OpenClaw launchd collectors are fallback-only and are not part of normal production ingestion.

## 2) Canonical AWS resources

Region: `us-east-1`

- Amplify app: `d2rgmein7vsf2e` (`main`)
- API Gateway HTTP API: `xmonitor-vpc-api` (`84kb8ehtp2`)
- Backend Lambda: `xmonitor-vpc-api`
- Compose worker Lambda: `xmonitor-vpc-compose-worker`
- Compose SQS queue: `xmonitor-compose-jobs`
- Compose DLQ: `xmonitor-compose-jobs-dlq`
- Priority collector Lambda: `xmonitor-xapi-priority-collector`
- Discovery collector Lambda: `xmonitor-xapi-discovery-collector`
- Priority EventBridge rule: `xmonitor-xapi-priority-collector-15m`
- Discovery EventBridge rule: `xmonitor-xapi-discovery-collector-60m`
- Lambda SG: `sg-0f09791e38a9f68d3`
- RDS SG: `sg-081e2d8e12101d117`
- DB/app secret: `xmonitor/rds/app`

## 3) Required secrets and env vars

Backend/API:
- `XMONITOR_INGEST_SHARED_SECRET`
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE=require`
- Compose env (`XMONITOR_COMPOSE_*`) and embedding env (`XMONITOR_EMBEDDING_*`) as needed

Collectors:
- `XMON_X_API_BEARER_TOKEN`
- `XMONITOR_API_KEY` (collector -> ingest auth)
- `XMONITOR_API_BASE_URL` (default `https://www.zodldashboard.com/api/v1`)
- `XMON_COLLECTOR_MODE` (`priority` or `discovery`)
- `XMONITOR_INGEST_OMIT_HANDLES`

## 4) Ingest auth contract

Protected routes accept one of:
- `x-api-key: <shared-secret>`
- `Authorization: Bearer <shared-secret>`

Protected route groups:
- `/v1/ingest/*`
- `/v1/ops/*`

## 5) Standard deployment workflow

### 5.1 Deploy web app (Amplify)

```bash
aws --profile zodldashboard --region us-east-1 amplify start-job \
  --app-id d2rgmein7vsf2e \
  --branch-name main \
  --job-type RELEASE
```

### 5.2 Reprovision backend API + compose worker

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
./scripts/aws/provision_vpc_api_lambda.sh
```

### 5.3 Reprovision priority collector

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
X_API_BEARER_TOKEN='<x-api-bearer-token>' \
./scripts/aws/provision_x_api_collector_lambda.sh
```

### 5.4 Reprovision discovery collector

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
X_API_BEARER_TOKEN='<x-api-bearer-token>' \
./scripts/aws/provision_x_api_discovery_collector_lambda.sh
```

## 6) Collector control operations

### Check collector rule state

```bash
aws --profile zodldashboard --region us-east-1 events describe-rule \
  --name xmonitor-xapi-priority-collector-15m \
  --query '{Name:Name,State:State,ScheduleExpression:ScheduleExpression}'

aws --profile zodldashboard --region us-east-1 events describe-rule \
  --name xmonitor-xapi-discovery-collector-60m \
  --query '{Name:Name,State:State,ScheduleExpression:ScheduleExpression}'
```

### Disable collectors (stop writes)

```bash
aws --profile zodldashboard --region us-east-1 events disable-rule \
  --name xmonitor-xapi-priority-collector-15m
aws --profile zodldashboard --region us-east-1 events disable-rule \
  --name xmonitor-xapi-discovery-collector-60m
```

### Re-enable collectors

```bash
aws --profile zodldashboard --region us-east-1 events enable-rule \
  --name xmonitor-xapi-priority-collector-15m
aws --profile zodldashboard --region us-east-1 events enable-rule \
  --name xmonitor-xapi-discovery-collector-60m
```

### One-shot collector invoke

```bash
aws --profile zodldashboard --region us-east-1 lambda invoke \
  --function-name xmonitor-xapi-priority-collector \
  --payload '{"source":"manual","mode":"priority"}' \
  /tmp/xmonitor-priority.json && cat /tmp/xmonitor-priority.json

aws --profile zodldashboard --region us-east-1 lambda invoke \
  --function-name xmonitor-xapi-discovery-collector \
  --payload '{"source":"manual","mode":"discovery"}' \
  /tmp/xmonitor-discovery.json && cat /tmp/xmonitor-discovery.json
```

## 7) Post-deploy verification

```bash
curl -sS 'https://www.zodldashboard.com/api/v1/health'
curl -sS 'https://www.zodldashboard.com/api/v1/feed?limit=3'
curl -sS 'https://www.zodldashboard.com/api/v1/window-summaries/latest'
```

Ingest auth negative/positive check:

```bash
curl -i -X POST 'https://www.zodldashboard.com/api/v1/ingest/runs' \
  -H 'content-type: application/json' \
  --data '{"run_at":"2026-03-02T00:00:00Z","mode":"manual"}'

curl -i -X POST 'https://www.zodldashboard.com/api/v1/ingest/runs' \
  -H 'content-type: application/json' \
  -H "x-api-key: $XMONITOR_API_KEY" \
  --data '{"run_at":"2026-03-02T00:00:00Z","mode":"manual"}'
```

## 8) Logging and triage

Priority collector logs:

```bash
aws --profile zodldashboard --region us-east-1 logs tail \
  '/aws/lambda/xmonitor-xapi-priority-collector' \
  --since 2h --follow
```

Discovery collector logs:

```bash
aws --profile zodldashboard --region us-east-1 logs tail \
  '/aws/lambda/xmonitor-xapi-discovery-collector' \
  --since 2h --follow
```

Backend API logs:

```bash
aws --profile zodldashboard --region us-east-1 logs tail \
  '/aws/lambda/xmonitor-vpc-api' \
  --since 1h --follow
```

Compose worker logs:

```bash
aws --profile zodldashboard --region us-east-1 logs tail \
  '/aws/lambda/xmonitor-vpc-compose-worker' \
  --since 1h --follow
```

## 9) Omit handle updates and cleanup

Use the repo utility:

```bash
python3 scripts/ops/omit_and_purge_handles.py @handle_one @handle_two \
  --update-lambda-env \
  --aws-profile zodldashboard \
  --aws-region us-east-1
```

This updates omit defaults in repo files, purges rows through `/v1/ops/purge-handle`, and updates collector Lambda env (`XMONITOR_INGEST_OMIT_HANDLES`).

## 10) Secret rotation

1. Generate a new secret:

```bash
openssl rand -hex 32
```

2. Update `xmonitor/rds/app` (`ingest_shared_secret`).
3. Reprovision backend and collectors so env is refreshed.
4. Update any operational shell/env values that send ingest writes (`XMONITOR_API_KEY`).
5. Trigger Amplify release if web runtime env changed.

## 11) Local fallback mode (only if needed)

Use local OpenClaw launchd collectors only for explicit rollback/testing.

Rules:
1. Never run AWS collectors and local collectors as active writers for the same mode at the same time.
2. Disable AWS EventBridge collector rules before enabling local launchd writers.
3. Re-enable AWS rules and disable local launchd writers once rollback window ends.

## 12) Migration status

- SQLite -> Postgres migration is complete.
- Production write path is AWS-side (X API collectors -> hosted ingest API -> VPC API -> RDS).
- Local OpenClaw runtime is not required for normal ZODL Dashboard + X Monitor operation.
