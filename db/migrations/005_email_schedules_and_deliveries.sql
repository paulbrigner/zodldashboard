ALTER TABLE compose_jobs
  ADD COLUMN IF NOT EXISTS owner_email CITEXT,
  ADD COLUMN IF NOT EXISTS owner_auth_mode TEXT;

CREATE INDEX IF NOT EXISTS idx_compose_jobs_owner_email_created_at
  ON compose_jobs (owner_email, created_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_email_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email CITEXT NOT NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,

  compose_request_json JSONB NOT NULL,
  recipients_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject_override TEXT,

  schedule_interval_minutes INTEGER NOT NULL CHECK (schedule_interval_minutes >= 15 AND schedule_interval_minutes <= 10080),
  lookback_hours INTEGER NOT NULL DEFAULT 24 CHECK (lookback_hours >= 1 AND lookback_hours <= 336),
  timezone TEXT NOT NULL DEFAULT 'UTC',

  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_status TEXT CHECK (last_status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (jsonb_typeof(compose_request_json) = 'object'),
  CHECK (jsonb_typeof(recipients_json) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_scheduled_email_jobs_owner_created_at
  ON scheduled_email_jobs (owner_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduled_email_jobs_enabled_next_run
  ON scheduled_email_jobs (enabled, next_run_at);

DROP TRIGGER IF EXISTS trg_scheduled_email_jobs_set_updated_at ON scheduled_email_jobs;
CREATE TRIGGER trg_scheduled_email_jobs_set_updated_at
BEFORE UPDATE ON scheduled_email_jobs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS scheduled_email_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_job_id UUID NOT NULL REFERENCES scheduled_email_jobs(job_id) ON DELETE CASCADE,
  owner_email CITEXT NOT NULL,

  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  compose_job_id UUID REFERENCES compose_jobs(job_id) ON DELETE SET NULL,
  delivery_id UUID,
  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (scheduled_job_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_email_runs_job_created_at
  ON scheduled_email_runs (scheduled_job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduled_email_runs_status_scheduled_for
  ON scheduled_email_runs (status, scheduled_for);

CREATE TABLE IF NOT EXISTS email_deliveries (
  delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email CITEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'scheduled')),

  scheduled_job_id UUID REFERENCES scheduled_email_jobs(job_id) ON DELETE SET NULL,
  scheduled_run_id UUID REFERENCES scheduled_email_runs(run_id) ON DELETE SET NULL,
  compose_job_id UUID REFERENCES compose_jobs(job_id) ON DELETE SET NULL,

  to_recipients_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  body_text TEXT NOT NULL,

  provider TEXT NOT NULL DEFAULT 'ses',
  provider_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,

  CHECK (jsonb_typeof(to_recipients_json) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_owner_created_at
  ON email_deliveries (owner_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_status_created_at
  ON email_deliveries (status, created_at DESC);

ALTER TABLE scheduled_email_runs
  DROP CONSTRAINT IF EXISTS fk_scheduled_email_runs_delivery;

ALTER TABLE scheduled_email_runs
  ADD CONSTRAINT fk_scheduled_email_runs_delivery
  FOREIGN KEY (delivery_id) REFERENCES email_deliveries(delivery_id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE scheduled_email_jobs TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE scheduled_email_runs TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE email_deliveries TO xmonitor_app;
  END IF;
END;
$$;
