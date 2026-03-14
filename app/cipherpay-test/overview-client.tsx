"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CipherPayDashboardData } from "@/lib/cipherpay-test/types";
import { LocalDateTime } from "../components/local-date-time";
import { CipherPayStatusPill } from "./status-pill";
import { cipherPayWebhookCallbackUrl, formatFiatAmount, readJsonOrThrow } from "./client-utils";

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="cipherpay-kpi-card">
      <p className="cipherpay-kpi-label">{label}</p>
      <p className="cipherpay-kpi-value">{value}</p>
      <p className="subtle-text cipherpay-kpi-detail">{detail}</p>
    </article>
  );
}

export function CipherPayTestOverviewClient() {
  const [data, setData] = useState<CipherPayDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState("");

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const nextData = await readJsonOrThrow<CipherPayDashboardData>(await fetch("/api/v1/cipherpay/dashboard", { cache: "no-store" }));
      setData(nextData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load CipherPay dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setOrigin(window.location.origin);
    void loadDashboard();
  }, []);

  const config = data?.config;
  const sessions = data?.sessions ?? [];
  const webhooks = data?.recent_webhooks ?? [];
  const webhookUrl = origin ? cipherPayWebhookCallbackUrl(origin) : "/api/v1/cipherpay/webhook";
  const configReady = Boolean(config?.has_api_key && config?.has_webhook_secret);

  return (
    <div className="cipherpay-page-body">
      <section className="cipherpay-section">
        <header className="cipherpay-section-header">
          <div>
            <h2>Overview</h2>
            <p className="subtle-text">Shared operational view of the test harness, recent checkouts, and webhook activity.</p>
          </div>
          <div className="button-row">
            <button className="button button-secondary button-small" onClick={() => void loadDashboard()} type="button">
              Refresh
            </button>
          </div>
        </header>

        {loading ? <p className="subtle-text">Loading CipherPay Test dashboard…</p> : null}
        {error ? <p className="cipherpay-error-text">{error}</p> : null}

        {data ? (
          <>
            <div className="cipherpay-kpi-grid">
              <StatCard
                label="Environment"
                value={config?.network === "mainnet" ? "Mainnet" : "Testnet"}
                detail={config?.api_base_url || "No API base configured yet"}
              />
              <StatCard
                label="Config"
                value={configReady ? "Ready" : "Needs setup"}
                detail={configReady ? "API key + webhook secret saved" : "Finish setup on the Admin tab"}
              />
              <StatCard
                label="Tracked checkouts"
                value={String(data.stats.total_sessions)}
                detail={`${data.stats.pending_sessions} pending, ${data.stats.detected_sessions} detected`}
              />
              <StatCard
                label="Confirmed"
                value={String(data.stats.confirmed_sessions)}
                detail={`${data.stats.invalid_webhooks} invalid webhook deliveries logged`}
              />
            </div>

            <div className="cipherpay-card-grid">
              <article className="cipherpay-detail-card">
                <h3>Webhook callback URL</h3>
                <p className="cipherpay-inline-code">{webhookUrl}</p>
                <p className="subtle-text">
                  Paste this into CipherPay settings so confirmed invoice events land back in this dashboard.
                </p>
                <div className="button-row">
                  <Link className="button button-secondary button-small" href="/cipherpay-test/admin">
                    Open admin
                  </Link>
                </div>
              </article>

              <article className="cipherpay-detail-card">
                <h3>Default test product</h3>
                <p>{config?.default_product_name || "CipherPay Test Purchase"}</p>
                <p className="subtle-text">
                  {formatFiatAmount(config?.default_amount ?? null, config?.default_currency ?? null)} default ticket size in{" "}
                  {config?.network === "mainnet" ? "production" : "sandbox"} mode.
                </p>
                <div className="button-row">
                  <Link className="button button-secondary button-small" href="/cipherpay-test/storefront">
                    Open storefront
                  </Link>
                </div>
              </article>

              <article className="cipherpay-detail-card">
                <h3>Stored secrets</h3>
                <p className="subtle-text">API key: {config?.api_key_preview || "not saved yet"}</p>
                <p className="subtle-text">Dashboard token: {config?.dashboard_token_preview || "not saved yet"}</p>
                <p className="subtle-text">Webhook secret: {config?.webhook_secret_preview || "not saved yet"}</p>
                <p className="subtle-text">
                  Last updated {config?.updated_at ? <LocalDateTime iso={config.updated_at} /> : "never"} by {config?.updated_by_email || "n/a"}.
                </p>
              </article>
            </div>
          </>
        ) : null}
      </section>

      <section className="cipherpay-section">
        <header className="cipherpay-section-header">
          <div>
            <h2>Recent checkouts</h2>
            <p className="subtle-text">Latest locally tracked invoices created through the test storefront.</p>
          </div>
        </header>

        {!sessions.length && !loading ? <p className="subtle-text">No CipherPay test sessions yet.</p> : null}

        {sessions.length ? (
          <div className="cipherpay-table-wrap">
            <table className="cipherpay-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Invoice</th>
                  <th>Amount</th>
                  <th>Last event</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.session_id}>
                    <td>
                      <strong>{session.product_name || "CipherPay invoice"}</strong>
                      <p className="subtle-text cipherpay-table-note">{session.size || session.cipherpay_memo_code || "No variant"}</p>
                    </td>
                    <td>
                      <CipherPayStatusPill status={session.status} />
                    </td>
                    <td className="cipherpay-mono-cell">{session.cipherpay_invoice_id}</td>
                    <td>{formatFiatAmount(session.amount, session.currency)}</td>
                    <td>
                      {session.last_event_at ? <LocalDateTime iso={session.last_event_at} /> : "n/a"}
                      <p className="subtle-text cipherpay-table-note">{session.last_event_type || "Waiting for updates"}</p>
                    </td>
                    <td>{session.created_at ? <LocalDateTime iso={session.created_at} /> : "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="cipherpay-section">
        <header className="cipherpay-section-header">
          <div>
            <h2>Webhook log</h2>
            <p className="subtle-text">Latest callbacks received from CipherPay, including signature verification results.</p>
          </div>
        </header>

        {!webhooks.length && !loading ? <p className="subtle-text">No webhook deliveries recorded yet.</p> : null}

        {webhooks.length ? (
          <div className="cipherpay-table-wrap">
            <table className="cipherpay-table">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Event</th>
                  <th>Invoice</th>
                  <th>Signature</th>
                  <th>TXID</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((event) => (
                  <tr key={event.event_id}>
                    <td>{event.received_at ? <LocalDateTime iso={event.received_at} /> : "n/a"}</td>
                    <td>{event.event_type || "unknown"}</td>
                    <td className="cipherpay-mono-cell">{event.cipherpay_invoice_id || "n/a"}</td>
                    <td>
                      <span className={event.signature_valid ? "cipherpay-valid-text" : "cipherpay-error-text"}>
                        {event.signature_valid ? "valid" : "invalid"}
                      </span>
                      {event.validation_error ? <p className="subtle-text cipherpay-table-note">{event.validation_error}</p> : null}
                    </td>
                    <td className="cipherpay-mono-cell">{event.txid || "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
