CREATE TABLE IF NOT EXISTS roadmap_access_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL,
  auth_mode TEXT NOT NULL
    CHECK (auth_mode IN ('oauth', 'local-bypass')),
  access_level TEXT NOT NULL
    CHECK (access_level IN ('workspace', 'guest', 'local-bypass')),
  outcome TEXT NOT NULL
    CHECK (outcome IN ('allowed', 'denied_guest', 'content_missing')),
  path TEXT NOT NULL DEFAULT '/zodl-roadmap',
  method TEXT NOT NULL DEFAULT 'GET',
  status_code INTEGER NOT NULL
    CHECK (status_code BETWEEN 100 AND 599),
  client_ip TEXT,
  user_agent TEXT,
  referer TEXT,
  request_id TEXT,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roadmap_access_events_accessed_at_desc
  ON roadmap_access_events (accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_roadmap_access_events_email_accessed_at_desc
  ON roadmap_access_events (email, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_roadmap_access_events_outcome_accessed_at_desc
  ON roadmap_access_events (outcome, accessed_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT ON TABLE roadmap_access_events TO xmonitor_app;
  END IF;
END $$;
