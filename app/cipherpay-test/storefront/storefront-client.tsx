"use client";

import { FormEvent, useEffect, useState } from "react";
import type { CipherPayDashboardData } from "@/lib/cipherpay-test/types";
import { LocalDateTime } from "../../components/local-date-time";
import { CipherPayStatusPill } from "../status-pill";
import { formatFiatAmount, readJsonOrThrow } from "../client-utils";

type CheckoutResponse = {
  session: CipherPayDashboardData["sessions"][number];
  invoice: {
    invoice_id: string;
    memo_code: string | null;
    payment_address: string | null;
    zcash_uri: string | null;
    price_zec: number | null;
    expires_at: string | null;
    checkout_url: string;
  };
};

export function CipherPayTestStorefrontClient() {
  const [data, setData] = useState<CipherPayDashboardData | null>(null);
  const [productName, setProductName] = useState("");
  const [amount, setAmount] = useState("1.00");
  const [currency, setCurrency] = useState("USD");
  const [size, setSize] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [syncingSessionId, setSyncingSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const nextData = await readJsonOrThrow<CipherPayDashboardData>(await fetch("/api/v1/cipherpay/dashboard", { cache: "no-store" }));
      setData(nextData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load storefront state");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (!data) return;
    if (!productName) setProductName(data.config.default_product_name);
    if (amount === "1.00") setAmount(data.config.default_amount.toFixed(2));
    if (currency === "USD") setCurrency(data.config.default_currency);
  }, [amount, currency, data, productName]);

  async function handleCreateCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await readJsonOrThrow<CheckoutResponse>(
        await fetch("/api/v1/cipherpay/checkout", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            product_name: productName,
            amount: Number(amount),
            currency,
            size: size.trim() || undefined,
          }),
        })
      );

      setNotice(`Created checkout ${response.invoice.invoice_id}. Hosted checkout opened in a new tab.`);
      window.open(response.invoice.checkout_url, "_blank", "noopener,noreferrer");
      await loadDashboard();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create checkout");
    } finally {
      setSubmitting(false);
    }
  }

  async function syncSession(sessionId: string) {
    setSyncingSessionId(sessionId);
    setError(null);
    setNotice(null);
    try {
      await readJsonOrThrow(
        await fetch(`/api/v1/cipherpay/sessions/${encodeURIComponent(sessionId)}/sync`, {
          method: "POST",
        })
      );
      setNotice("Session synced from CipherPay.");
      await loadDashboard();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Failed to sync session");
    } finally {
      setSyncingSessionId(null);
    }
  }

  const configReady = Boolean(data?.config.has_api_key);
  const sessions = data?.sessions ?? [];

  return (
    <div className="cipherpay-page-body">
      <section className="cipherpay-section">
        <header className="cipherpay-section-header">
          <div>
            <h2>Storefront</h2>
            <p className="subtle-text">Create a minimal checkout, open CipherPay hosted pay, then watch the webhook and sync pipeline update the order.</p>
          </div>
        </header>

        <div className="cipherpay-callout">
          <strong>Test flow</strong>
          <p>
            Save your testnet API key and webhook secret on the Admin tab, create a checkout here, then pay it from a Zcash wallet. The local session
            status updates automatically when CipherPay calls the webhook endpoint, and you can manually sync if you need to poll the public invoice API.
          </p>
        </div>

        {loading ? <p className="subtle-text">Loading storefront…</p> : null}
        {error ? <p className="cipherpay-error-text">{error}</p> : null}
        {notice ? <p className="cipherpay-valid-text">{notice}</p> : null}

        <form className="cipherpay-form" onSubmit={handleCreateCheckout}>
          <div className="cipherpay-form-grid">
            <label className="cipherpay-field">
              <span>Product</span>
              <input className="cipherpay-input" onChange={(event) => setProductName(event.target.value)} type="text" value={productName} />
            </label>

            <label className="cipherpay-field">
              <span>Amount</span>
              <input className="cipherpay-input" min="0.01" onChange={(event) => setAmount(event.target.value)} step="0.01" type="number" value={amount} />
            </label>

            <label className="cipherpay-field">
              <span>Currency</span>
              <input className="cipherpay-input" maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} type="text" value={currency} />
            </label>

            <label className="cipherpay-field">
              <span>Variant / size</span>
              <input className="cipherpay-input" onChange={(event) => setSize(event.target.value)} placeholder="Optional" type="text" value={size} />
            </label>
          </div>

          <div className="button-row">
            <button className="button" disabled={submitting || !configReady} type="submit">
              {submitting ? "Creating…" : "Create checkout"}
            </button>
            {!configReady ? <span className="subtle-text">Add an API key on the Admin tab before creating checkouts.</span> : null}
          </div>
        </form>
      </section>

      <section className="cipherpay-section">
        <header className="cipherpay-section-header">
          <div>
            <h2>Recent sessions</h2>
            <p className="subtle-text">The newest CipherPay test sessions, including pay links, invoice metadata, and manual sync controls.</p>
          </div>
        </header>

        {!sessions.length && !loading ? <p className="subtle-text">No storefront sessions yet.</p> : null}

        {sessions.length ? (
          <div className="cipherpay-table-wrap">
            <table className="cipherpay-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Hosted checkout</th>
                  <th>Invoice</th>
                  <th>ZEC</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.session_id}>
                    <td>
                      <strong>{session.product_name || "CipherPay invoice"}</strong>
                      <p className="subtle-text cipherpay-table-note">{formatFiatAmount(session.amount, session.currency)}</p>
                    </td>
                    <td>
                      <CipherPayStatusPill status={session.status} />
                      <p className="subtle-text cipherpay-table-note">{session.last_event_type || "No webhook yet"}</p>
                    </td>
                    <td className="cipherpay-mono-cell">
                      {session.checkout_url ? (
                        <a href={session.checkout_url} rel="noreferrer" target="_blank">
                          open checkout
                        </a>
                      ) : (
                        "n/a"
                      )}
                    </td>
                    <td className="cipherpay-mono-cell">
                      {session.cipherpay_invoice_id}
                      <p className="subtle-text cipherpay-table-note">{session.cipherpay_memo_code || "No memo code"}</p>
                    </td>
                    <td>{session.cipherpay_price_zec != null ? `${session.cipherpay_price_zec.toFixed(8)} ZEC` : "n/a"}</td>
                    <td>{session.cipherpay_expires_at ? <LocalDateTime iso={session.cipherpay_expires_at} /> : "n/a"}</td>
                    <td>
                      <div className="button-row">
                        <button
                          className="button button-secondary button-small"
                          disabled={syncingSessionId === session.session_id}
                          onClick={() => void syncSession(session.session_id)}
                          type="button"
                        >
                          {syncingSessionId === session.session_id ? "Syncing…" : "Sync"}
                        </button>
                      </div>
                    </td>
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
