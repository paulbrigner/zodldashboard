ALTER TABLE email_deliveries
  DROP CONSTRAINT IF EXISTS email_deliveries_source_check;

ALTER TABLE email_deliveries
  ADD CONSTRAINT email_deliveries_source_check
  CHECK (source IN ('manual', 'scheduled', 'dashboard-update'));

CREATE TABLE IF NOT EXISTS dashboard_update_subscriptions (
  dashboard_id TEXT NOT NULL,
  email CITEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dashboard_id, email)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_update_subscriptions_email
  ON dashboard_update_subscriptions (email, enabled, dashboard_id);

DROP TRIGGER IF EXISTS trg_dashboard_update_subscriptions_set_updated_at ON dashboard_update_subscriptions;
CREATE TRIGGER trg_dashboard_update_subscriptions_set_updated_at
BEFORE UPDATE ON dashboard_update_subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS dashboard_update_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'api', 'github', 'admin')),
  source_ref TEXT,
  created_by CITEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_update_events_dashboard_created_at
  ON dashboard_update_events (dashboard_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dashboard_update_notification_deliveries (
  event_id UUID NOT NULL REFERENCES dashboard_update_events(event_id) ON DELETE CASCADE,
  email CITEXT NOT NULL,
  delivery_id UUID REFERENCES email_deliveries(delivery_id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  PRIMARY KEY (event_id, email)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_update_notification_deliveries_email_created_at
  ON dashboard_update_notification_deliveries (email, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE dashboard_update_subscriptions TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE dashboard_update_events TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE dashboard_update_notification_deliveries TO xmonitor_app;
  END IF;
END;
$$;
