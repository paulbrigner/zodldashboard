CREATE TABLE IF NOT EXISTS xmonitor_client_usage_windows (
  client_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  window_kind TEXT NOT NULL CHECK (window_kind IN ('burst', 'daily')),
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, capability, window_kind, window_start)
);

CREATE INDEX IF NOT EXISTS idx_xmonitor_client_usage_windows_expires_at
  ON xmonitor_client_usage_windows (expires_at);

DROP TRIGGER IF EXISTS trg_xmonitor_client_usage_windows_set_updated_at
  ON xmonitor_client_usage_windows;
CREATE TRIGGER trg_xmonitor_client_usage_windows_set_updated_at
BEFORE UPDATE ON xmonitor_client_usage_windows
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE xmonitor_client_usage_windows TO xmonitor_app;
  END IF;
END;
$$;
