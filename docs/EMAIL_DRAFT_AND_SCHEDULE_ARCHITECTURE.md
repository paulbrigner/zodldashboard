# Email Draft + Scheduled Delivery Architecture

This document describes the X Monitor "Draft Format: Email" feature, immediate email send, and per-user scheduled email jobs.

## Scope

- Add `email` as a compose draft format in Answer Mode.
- Return structured `email_draft` fields from grounded answer synthesis:
  - `subject`
  - `body_markdown`
  - `body_text` (optional; derived if omitted)
- Allow authenticated users to send email immediately.
- Allow authenticated users to create/manage scheduled email jobs:
  - create
  - edit
  - enable/disable
  - run-now
  - delete

## Auth model

- UI access still depends on site auth (`/x-monitor`).
- Email actions are OAuth-only by default (`XMONITOR_EMAIL_REQUIRE_OAUTH=true`).
- Next.js API proxy routes inject verified user context headers:
  - `x-xmonitor-viewer-email`
  - `x-xmonitor-viewer-auth-mode`
  - `x-xmonitor-viewer-secret`
- Backend verifies `x-xmonitor-viewer-secret` against `XMONITOR_USER_PROXY_SECRET`.

## Data model

Migration: `db/migrations/005_email_schedules_and_deliveries.sql`

- `scheduled_email_jobs`
  - per-user persisted schedule definitions
  - compose request template + recipients + subject override + schedule interval + lookback
  - lifecycle state (`enabled`, `next_run_at`, `last_status`, `last_error`, `run_count`)

- `scheduled_email_runs`
  - one execution row per scheduled run
  - status transitions: `queued -> running -> succeeded|failed|skipped`

- `email_deliveries`
  - SES delivery audit rows for manual and scheduled sends
  - provider message id + send status/error

- `compose_jobs` extended with:
  - `owner_email`
  - `owner_auth_mode`

## Runtime flow

### Immediate send flow

1. User selects `Draft Format = Email` and generates answer.
2. UI receives `email_draft` and lets user edit `To`, `Subject`, `Body`.
3. UI calls `POST /api/v1/email/send`.
4. Next proxy injects viewer context headers and forwards to backend `POST /v1/email/send`.
5. Backend validates payload + recipients, sends via SES, persists `email_deliveries`.

### Scheduled flow

1. User creates schedule from Answer Mode UI via `POST /api/v1/email/schedules`.
2. Backend stores `scheduled_email_jobs` with `next_run_at`.
3. EventBridge invokes scheduler Lambda (`index.schedulerHandler`) on interval.
4. Scheduler finds due jobs, inserts `scheduled_email_runs`, advances `next_run_at`, enqueues each run to SQS (`XMONITOR_COMPOSE_JOBS_QUEUE_URL`).
5. Worker Lambda (`index.sqsHandler`) processes `scheduled_email_run` messages:
   - executes grounded retrieval/synthesis with rolling lookback window
   - builds final email subject/body
   - sends via SES
   - updates `scheduled_email_runs`, `scheduled_email_jobs`, `email_deliveries`

## API surface (backend `/v1`)

- `POST /email/send`
- `GET /email/schedules`
- `POST /email/schedules`
- `PATCH /email/schedules/{jobId}`
- `DELETE /email/schedules/{jobId}`
- `POST /email/schedules/{jobId}/run-now`

OpenAPI: `docs/openapi.v1.yaml`

## AWS components

- API Lambda: `xmonitor-vpc-api`
- Worker Lambda: `xmonitor-vpc-compose-worker` (`index.sqsHandler`)
- Scheduler Lambda: `xmonitor-vpc-email-scheduler` (`index.schedulerHandler`)
- Queue: `xmonitor-compose-jobs` (shared with async compose jobs)
- Rule: `xmonitor-email-schedule-dispatch` (default `rate(5 minutes)`)
- SES identity/sending configuration for configured `XMONITOR_EMAIL_FROM_ADDRESS`

Provisioning script:

- `scripts/aws/provision_vpc_api_lambda.sh`

## Core env vars

- Feature flags:
  - `XMONITOR_EMAIL_ENABLED`
  - `XMONITOR_EMAIL_SCHEDULES_ENABLED`
  - `XMONITOR_EMAIL_REQUIRE_OAUTH`
- Security:
  - `XMONITOR_USER_PROXY_SECRET`
- SES:
  - `XMONITOR_EMAIL_FROM_ADDRESS`
  - `XMONITOR_EMAIL_FROM_NAME`
- Limits:
  - `XMONITOR_EMAIL_MAX_RECIPIENTS`
  - `XMONITOR_EMAIL_MAX_JOBS_PER_USER`
  - `XMONITOR_EMAIL_MAX_BODY_CHARS`
  - `XMONITOR_EMAIL_SCHEDULE_DISPATCH_LIMIT`
