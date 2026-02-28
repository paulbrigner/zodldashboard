CREATE TABLE IF NOT EXISTS compose_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'expired')),

  request_hash TEXT,
  request_payload_json JSONB NOT NULL,
  result_payload_json JSONB,

  error_code TEXT,
  error_message TEXT,

  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours')
);

CREATE INDEX IF NOT EXISTS idx_compose_jobs_status_created_at
  ON compose_jobs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compose_jobs_expires_at
  ON compose_jobs (expires_at);

CREATE INDEX IF NOT EXISTS idx_compose_jobs_request_hash_created_at
  ON compose_jobs (request_hash, created_at DESC);

DROP TRIGGER IF EXISTS trg_compose_jobs_set_updated_at ON compose_jobs;
CREATE TRIGGER trg_compose_jobs_set_updated_at
BEFORE UPDATE ON compose_jobs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE compose_jobs TO xmonitor_app;
  END IF;
END;
$$;
