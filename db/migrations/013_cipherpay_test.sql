CREATE TABLE IF NOT EXISTS cipherpay_test_config (
  config_key TEXT PRIMARY KEY DEFAULT 'default' CHECK (config_key = 'default'),
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  api_base_url TEXT NOT NULL,
  checkout_base_url TEXT NOT NULL,
  api_key TEXT,
  webhook_secret TEXT,
  default_currency TEXT NOT NULL DEFAULT 'USD',
  default_product_name TEXT NOT NULL DEFAULT 'CipherPay Test Purchase',
  default_amount NUMERIC(12, 2) NOT NULL DEFAULT 1.00,
  updated_by_email CITEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cipherpay_test_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_email CITEXT,
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  product_name TEXT,
  size TEXT,
  amount NUMERIC(12, 2),
  currency TEXT,
  checkout_url TEXT,
  cipherpay_invoice_id TEXT NOT NULL UNIQUE,
  cipherpay_memo_code TEXT,
  cipherpay_payment_address TEXT,
  cipherpay_zcash_uri TEXT,
  cipherpay_price_zec DOUBLE PRECISION,
  cipherpay_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'underpaid', 'detected', 'confirmed', 'expired', 'refunded', 'unknown')),
  last_event_type TEXT,
  last_event_at TIMESTAMPTZ,
  last_txid TEXT,
  last_payload_json JSONB,
  synced_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cipherpay_test_sessions_status_created_at
  ON cipherpay_test_sessions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cipherpay_test_sessions_last_event_at
  ON cipherpay_test_sessions (last_event_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_cipherpay_test_sessions_created_by_email_created_at
  ON cipherpay_test_sessions (created_by_email, created_at DESC);

CREATE TABLE IF NOT EXISTS cipherpay_test_webhook_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cipherpay_invoice_id TEXT,
  event_type TEXT,
  txid TEXT,
  signature_valid BOOLEAN NOT NULL,
  validation_error TEXT,
  timestamp_header TEXT,
  request_body_json JSONB,
  request_headers_json JSONB,
  source_ip TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cipherpay_test_webhook_events_invoice_received_at
  ON cipherpay_test_webhook_events (cipherpay_invoice_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_cipherpay_test_webhook_events_received_at
  ON cipherpay_test_webhook_events (received_at DESC);

DROP TRIGGER IF EXISTS trg_cipherpay_test_config_set_updated_at ON cipherpay_test_config;
CREATE TRIGGER trg_cipherpay_test_config_set_updated_at
BEFORE UPDATE ON cipherpay_test_config
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_cipherpay_test_sessions_set_updated_at ON cipherpay_test_sessions;
CREATE TRIGGER trg_cipherpay_test_sessions_set_updated_at
BEFORE UPDATE ON cipherpay_test_sessions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cipherpay_test_config TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cipherpay_test_sessions TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cipherpay_test_webhook_events TO xmonitor_app;
  END IF;
END $$;
