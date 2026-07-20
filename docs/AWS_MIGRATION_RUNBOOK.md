# XMonitor AWS Operations Runbook

_Last updated: 2026-07-20 (ET)_

This runbook describes the active production architecture and operational controls.

## 1) Current production topology

Primary write path (AWS-only):
1. EventBridge triggers scheduled collector Lambdas:
   - `xmonitor-xapi-priority-collector` (`rate(15 minutes)`)
   - `xmonitor-xapi-discovery-collector` (`rate(30 minutes)`)
2. Collector Lambda fetches X posts from X API.
3. Collector applies normalization and active capture gates (language allowlist, omit handles, required base-term relevance, and empty/URL-only stub rejection).
4. Collector ingests to hosted API (`/api/v1/ingest/*`) using shared-secret auth.
5. Hosted API proxies to VPC API Lambda (`/v1/*`) and writes to RDS PostgreSQL.
6. Async significance classification runs after ingest and updates significance fields in PostgreSQL.
7. Discovery collector also generates/ingests `rolling_2h` + `rolling_12h` summaries (aligned windows, every 2 hours UTC), plus a `rolling_7d_daily` summary on a dedicated daily `6:00 AM America/New_York` schedule.
8. Email scheduler Lambda dispatches due scheduled-email jobs to SQS; compose worker executes runs and sends via SES.

Read path:
1. An authenticated viewer requests the Amplify-hosted Next.js app.
2. Browser reads use the same-origin `/api/v1/*` BFF, which verifies the viewer session and X Monitor permission.
3. The BFF and server-rendered pages call the direct backend with a server-only read-client ID and secret.
4. The backend validates the client credential, reads RDS, and returns feed/detail/summary responses. Direct database mode remains a local-development fallback.

## 2) Canonical AWS resources

Region: `us-east-1`

- Amplify app: `d2rgmein7vsf2e` (`main`)
- API Gateway HTTP API: `xmonitor-vpc-api` (`84kb8ehtp2`)
- Backend Lambda: `xmonitor-vpc-api`
- Compose worker Lambda: `xmonitor-vpc-compose-worker`
- Email scheduler Lambda: `xmonitor-vpc-email-scheduler`
- Compose SQS queue: `xmonitor-compose-jobs`
- Compose DLQ: `xmonitor-compose-jobs-dlq`
- Email schedule rule: `xmonitor-email-schedule-dispatch` (`rate(5 minutes)`)
- Priority collector Lambda: `xmonitor-xapi-priority-collector`
- Discovery collector Lambda: `xmonitor-xapi-discovery-collector`
- Priority EventBridge rule: `xmonitor-xapi-priority-collector-15m`
- Discovery EventBridge rule: `xmonitor-xapi-discovery-collector-30m`
- Lambda SG: `sg-0f09791e38a9f68d3`
- RDS SG: `sg-081e2d8e12101d117`
- DB/app secret: `xmonitor/rds/app`

## 3) Required secrets and env vars

Backend/API:
- `XMONITOR_INGEST_SHARED_SECRET`
- `XMONITOR_READ_CLIENTS_SECRET_ID` (backend-only Secrets Manager source whose `read_clients` map holds one or more active secrets per client ID)
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE=require`
- Compose env (`XMONITOR_COMPOSE_*`) and embedding env (`XMONITOR_EMBEDDING_*`) as needed
- Email env when enabled:
  - `XMONITOR_EMAIL_ENABLED`
  - `XMONITOR_EMAIL_SCHEDULES_ENABLED`
  - `XMONITOR_EMAIL_REQUIRE_OAUTH`
  - `XMONITOR_USER_PROXY_SECRET`
  - `XMONITOR_EMAIL_FROM_ADDRESS`
  - `XMONITOR_EMAIL_FROM_NAME`
  - `XMONITOR_ENABLE_EMAIL_SCHEMA_BOOTSTRAP` (set `true` if applying schema inside VPC Lambda instead of direct `psql` from ops host)
  - `XMONITOR_ENABLE_DB_MIGRATIONS_BOOTSTRAP` (set `true` only for a controlled migration window when packaged SQL must be applied from inside the VPC Lambda)
  - `XMONITOR_DB_MIGRATIONS_FROM_FILE` (set when the app DB role should start at a specific migration, e.g. skip privileged bootstrap migrations and apply only a later cleanup migration)

Collectors:
- `XMON_X_API_BEARER_TOKEN`
- `XMONITOR_API_KEY` (collector -> ingest auth)
- `XMONITOR_API_BASE_URL` (collector ingest base; normally the dashboard app's `/api/v1` path)
- `XMON_COLLECTOR_MODE` (`priority` or `discovery`)
- `XMONITOR_INGEST_OMIT_HANDLES`

Amplify-hosted app:
- `XMONITOR_READ_API_BASE_URL` and `XMONITOR_BACKEND_API_BASE_URL` (direct backend base URL)
- `XMONITOR_READ_CLIENT_ID`
- `XMONITOR_READ_CLIENT_SECRET` (server-only; never expose it through a `NEXT_PUBLIC_*` variable)

## 4) API auth contracts

### 4.1 Ingest and operations

Protected routes accept one of:
- `x-api-key: <shared-secret>`
- `Authorization: Bearer <shared-secret>`

Protected route groups:
- `/v1/ingest/*`
- `/v1/ops/*`

### 4.2 X Monitor reads

Direct backend reads require both:

- `x-xmonitor-client-id: <client-id>`
- `x-xmonitor-client-secret: <client-secret>`

The backend validates them against the `read_clients` map in the secret selected by `XMONITOR_READ_CLIENTS_SECRET_ID`. Use a distinct
client ID and secret per server-side consumer so one host can be rotated or
revoked independently. The protected set is `/v1/feed`,
`/v1/author-locations`, `/v1/engagement`, `/v1/trends`,
`/v1/window-summaries/latest`, and `/v1/posts/{statusId}`. `/v1/health` remains
unsigned.

Browser clients do not receive this credential. They use the dashboard
`/api/v1` BFF, which requires an authenticated viewer session before injecting
the server-side credential.

## 5) Standard deployment workflow

### 5.1 Deploy web app (Amplify)

```bash
aws --profile zodldashboard --region us-east-1 amplify start-job \
  --app-id d2rgmein7vsf2e \
  --branch-name main \
  --job-type RELEASE
```

### 5.2 Reprovision backend API + compose worker + email scheduler

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
  --name xmonitor-xapi-discovery-collector-30m \
  --query '{Name:Name,State:State,ScheduleExpression:ScheduleExpression}'
```

### Disable collectors (stop writes)

```bash
aws --profile zodldashboard --region us-east-1 events disable-rule \
  --name xmonitor-xapi-priority-collector-15m
aws --profile zodldashboard --region us-east-1 events disable-rule \
  --name xmonitor-xapi-discovery-collector-30m
```

### Re-enable collectors

```bash
aws --profile zodldashboard --region us-east-1 events enable-rule \
  --name xmonitor-xapi-priority-collector-15m
aws --profile zodldashboard --region us-east-1 events enable-rule \
  --name xmonitor-xapi-discovery-collector-30m
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
read_api_base="${XMONITOR_BACKEND_API_BASE_URL:?set the direct backend base URL}"
app_base="${XMONITOR_APP_BASE_URL:?set the dashboard app base URL}"

# Health is intentionally unsigned.
curl -sS "$read_api_base/health"

# Direct reads fail without client authentication, then succeed with it.
curl -i "$read_api_base/feed?limit=1"
curl -sS \
  -H "x-xmonitor-client-id: ${XMONITOR_READ_CLIENT_ID:?set the read client ID}" \
  -H "x-xmonitor-client-secret: ${XMONITOR_READ_CLIENT_SECRET:?set the read client secret}" \
  "$read_api_base/feed?limit=3"
curl -sS \
  -H "x-xmonitor-client-id: $XMONITOR_READ_CLIENT_ID" \
  -H "x-xmonitor-client-secret: $XMONITOR_READ_CLIENT_SECRET" \
  "$read_api_base/window-summaries/latest"

# The browser BFF also rejects a request with no viewer session.
curl -i "$app_base/api/v1/feed?limit=1"
```

Ingest auth negative/positive check:

```bash
curl -i -X POST "$app_base/api/v1/ingest/runs" \
  -H 'content-type: application/json' \
  --data '{"run_at":"2026-03-02T00:00:00Z","mode":"manual"}'

curl -i -X POST "$app_base/api/v1/ingest/runs" \
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

Email scheduler logs:

```bash
aws --profile zodldashboard --region us-east-1 logs tail \
  '/aws/lambda/xmonitor-vpc-email-scheduler' \
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

This updates the canonical omit config in the repo, purges rows through `/v1/ops/purge-handle`, and updates backend + collector Lambda envs (`XMONITOR_INGEST_OMIT_HANDLES`).

## 10) Secret rotation

1. Generate a new secret:

```bash
openssl rand -hex 32
```

2. Update `xmonitor/rds/app` (`ingest_shared_secret`).
3. Reprovision backend and collectors so env is refreshed.
4. Update any operational shell/env values that send ingest writes (`XMONITOR_API_KEY`).
5. Trigger Amplify release if web runtime env changed.

For a read-client rotation, add the new value beside the old one in that
client's `read_clients` array. Wait at least five minutes for backend caches,
switch and redeploy only that caller, wait another five minutes, then remove
the old value. Do not reuse or rotate the viewer-proxy or ingest secret as part
of a read-client change.

## 11) System status

- PostgreSQL is the system of record.
- Production writes run through the AWS collector and backend stack.
- The active read surface is the hosted web app and `/api/v1/*` APIs.
