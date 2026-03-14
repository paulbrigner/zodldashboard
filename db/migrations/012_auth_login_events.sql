CREATE TABLE IF NOT EXISTS auth_login_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL,
  provider TEXT NOT NULL,
  auth_mode TEXT NOT NULL DEFAULT 'oauth'
    CHECK (auth_mode = 'oauth'),
  access_level TEXT NOT NULL
    CHECK (access_level IN ('workspace', 'guest')),
  logged_in_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_login_events_logged_in_at_desc
  ON auth_login_events (logged_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_login_events_email_logged_in_at_desc
  ON auth_login_events (email, logged_in_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT ON TABLE auth_login_events TO xmonitor_app;
  END IF;
END $$;
