CREATE TABLE IF NOT EXISTS ingest_query_checkpoints (
  query_key TEXT PRIMARY KEY,
  collector_mode TEXT NOT NULL CHECK (collector_mode IN ('priority', 'discovery')),
  query_family TEXT NOT NULL,
  query_text_hash TEXT NOT NULL,
  query_handles_hash TEXT,
  since_id TEXT,
  last_newest_id TEXT,
  last_seen_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT CHECK (last_run_status IN ('ok', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingest_query_checkpoints_mode_family
  ON ingest_query_checkpoints (collector_mode, query_family);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ingest_query_checkpoints TO xmonitor_app;
  END IF;
END;
$$;
