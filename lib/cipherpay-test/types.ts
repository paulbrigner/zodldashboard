export type CipherPayNetwork = "testnet" | "mainnet";

export type CipherPayTestSessionStatus =
  | "draft"
  | "pending"
  | "underpaid"
  | "detected"
  | "confirmed"
  | "expired"
  | "refunded"
  | "unknown";

export type CipherPayTestConfig = {
  network: CipherPayNetwork;
  api_base_url: string;
  checkout_base_url: string;
  default_currency: string;
  default_product_name: string;
  default_amount: number;
  has_api_key: boolean;
  api_key_preview: string | null;
  has_webhook_secret: boolean;
  webhook_secret_preview: string | null;
  updated_by_email: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CipherPayTestSession = {
  session_id: string;
  created_by_email: string | null;
  network: CipherPayNetwork;
  product_name: string | null;
  size: string | null;
  amount: number | null;
  currency: string | null;
  checkout_url: string | null;
  cipherpay_invoice_id: string;
  cipherpay_memo_code: string | null;
  cipherpay_payment_address: string | null;
  cipherpay_zcash_uri: string | null;
  cipherpay_price_zec: number | null;
  cipherpay_expires_at: string | null;
  status: CipherPayTestSessionStatus;
  last_event_type: string | null;
  last_event_at: string | null;
  last_txid: string | null;
  last_payload_json: Record<string, unknown> | null;
  synced_at: string | null;
  detected_at: string | null;
  confirmed_at: string | null;
  refunded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CipherPayWebhookEvent = {
  event_id: string;
  cipherpay_invoice_id: string | null;
  event_type: string | null;
  txid: string | null;
  signature_valid: boolean;
  validation_error: string | null;
  timestamp_header: string | null;
  request_body_json: Record<string, unknown> | null;
  request_headers_json: Record<string, unknown> | null;
  source_ip: string | null;
  received_at: string | null;
};

export type CipherPayDashboardData = {
  viewer_email: string;
  config: CipherPayTestConfig;
  stats: {
    total_sessions: number;
    pending_sessions: number;
    detected_sessions: number;
    confirmed_sessions: number;
    expired_sessions: number;
    invalid_webhooks: number;
  };
  sessions: CipherPayTestSession[];
  recent_webhooks: CipherPayWebhookEvent[];
};
