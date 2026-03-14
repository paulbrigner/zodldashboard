"use client";

import { FormEvent, useEffect, useState } from "react";
import type {
  CipherPayCatalogPrice,
  CipherPayCatalogProduct,
  CipherPayStorefrontData,
} from "@/lib/cipherpay-test/types";
import { LocalDateTime } from "../../components/local-date-time";
import { CipherPayStatusPill } from "../status-pill";
import { formatFiatAmount, readJsonOrThrow } from "../client-utils";

type CheckoutResponse = {
  session: CipherPayStorefrontData["sessions"][number];
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

function supportedCatalogPrices(product: CipherPayCatalogProduct) {
  return product.prices.filter((price) => price.active && price.price_type === "one_time");
}

function pickDefaultCatalogPrice(product: CipherPayCatalogProduct, preferredCurrency: string | null): CipherPayCatalogPrice | null {
  const prices = supportedCatalogPrices(product);
  if (!prices.length) return null;
  const defaultPrice = product.default_price_id ? prices.find((price) => price.id === product.default_price_id) : null;
  if (defaultPrice) return defaultPrice;
  const preferred = preferredCurrency ? prices.find((price) => price.currency === preferredCurrency) : null;
  return preferred || prices[0];
}

function recurringPriceSummary(price: CipherPayCatalogPrice) {
  if (price.price_type !== "recurring") return null;
  const interval = price.billing_interval || "period";
  const count = price.interval_count && price.interval_count > 1 ? `every ${price.interval_count} ${interval}s` : `every ${interval}`;
  return count;
}

export function CipherPayTestStorefrontClient() {
  const [data, setData] = useState<CipherPayStorefrontData | null>(null);
  const [manualProductName, setManualProductName] = useState("");
  const [manualAmount, setManualAmount] = useState("1.00");
  const [manualCurrency, setManualCurrency] = useState("USD");
  const [manualSize, setManualSize] = useState("");
  const [selectedPriceIds, setSelectedPriceIds] = useState<Record<string, string>>({});
  const [catalogVariants, setCatalogVariants] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [catalogSubmittingProductId, setCatalogSubmittingProductId] = useState<string | null>(null);
  const [syncingSessionId, setSyncingSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadStorefront() {
    setLoading(true);
    setError(null);
    try {
      const nextData = await readJsonOrThrow<CipherPayStorefrontData>(await fetch("/api/v1/cipherpay/storefront", { cache: "no-store" }));
      setData(nextData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load storefront state");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStorefront();
  }, []);

  useEffect(() => {
    if (!data) return;
    if (!manualProductName) setManualProductName(data.config.default_product_name);
    if (manualAmount === "1.00") setManualAmount(data.config.default_amount.toFixed(2));
    if (manualCurrency === "USD") setManualCurrency(data.config.default_currency);

    setSelectedPriceIds((current) => {
      let changed = false;
      const next = { ...current };
      for (const product of data.catalog.products) {
        const prices = supportedCatalogPrices(product);
        if (!prices.length) continue;
        const currentPriceId = next[product.id];
        if (!currentPriceId || !prices.some((price) => price.id === currentPriceId)) {
          const fallbackPrice = pickDefaultCatalogPrice(product, data.config.default_currency);
          if (fallbackPrice) {
            next[product.id] = fallbackPrice.id;
            changed = true;
          }
        }
      }
      return changed ? next : current;
    });
  }, [data, manualAmount, manualCurrency, manualProductName]);

  async function handleManualCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setManualSubmitting(true);
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
            product_name: manualProductName,
            amount: Number(manualAmount),
            currency: manualCurrency,
            size: manualSize.trim() || undefined,
          }),
        })
      );

      setNotice(`Created checkout ${response.invoice.invoice_id}. Hosted checkout opened in a new tab.`);
      window.open(response.invoice.checkout_url, "_blank", "noopener,noreferrer");
      await loadStorefront();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create checkout");
    } finally {
      setManualSubmitting(false);
    }
  }

  async function createCatalogCheckout(product: CipherPayCatalogProduct) {
    const selectedPriceId = selectedPriceIds[product.id];
    setCatalogSubmittingProductId(product.id);
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
            product_id: product.id,
            price_id: selectedPriceId || undefined,
            size: (catalogVariants[product.id] || "").trim() || undefined,
          }),
        })
      );

      setNotice(`Created checkout ${response.invoice.invoice_id}. Hosted checkout opened in a new tab.`);
      window.open(response.invoice.checkout_url, "_blank", "noopener,noreferrer");
      await loadStorefront();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create catalog checkout");
    } finally {
      setCatalogSubmittingProductId(null);
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
      await loadStorefront();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Failed to sync session");
    } finally {
      setSyncingSessionId(null);
    }
  }

  const sessions = data?.sessions ?? [];
  const catalog = data?.catalog;
  const products = catalog?.products ?? [];
  const manualCheckoutReady = Boolean(data?.config.has_api_key);

  return (
    <div className="cipherpay-page-body">
      <section className="cipherpay-section">
        <header className="cipherpay-section-header">
          <div>
            <h2>Catalog products</h2>
            <p className="subtle-text">Loaded from your CipherPay merchant dashboard and ready to launch into hosted checkout.</p>
          </div>
          <div className="button-row">
            <button className="button button-secondary button-small" onClick={() => void loadStorefront()} type="button">
              Refresh
            </button>
          </div>
        </header>

        {loading ? <p className="subtle-text">Loading storefront…</p> : null}
        {error ? <p className="cipherpay-error-text">{error}</p> : null}
        {notice ? <p className="cipherpay-valid-text">{notice}</p> : null}
        {!catalog?.has_dashboard_token && !loading ? (
          <p className="subtle-text">Add a CipherPay dashboard token on the Admin tab to load your product catalog.</p>
        ) : null}
        {catalog?.error ? <p className="cipherpay-error-text">{catalog.error}</p> : null}
        {!products.length && catalog?.has_dashboard_token && !catalog?.error && !loading ? (
          <p className="subtle-text">No active one-time products were returned from CipherPay.</p>
        ) : null}

        {products.length ? (
          <div className="cipherpay-catalog-grid">
            {products.map((product) => {
              const oneTimePrices = supportedCatalogPrices(product);
              const recurringPrices = product.prices.filter((price) => price.active && price.price_type !== "one_time");
              const selectedPrice =
                oneTimePrices.find((price) => price.id === selectedPriceIds[product.id]) ||
                pickDefaultCatalogPrice(product, data?.config.default_currency || null);

              return (
                <article className="cipherpay-catalog-card" key={product.id}>
                  <div className="cipherpay-catalog-header">
                    <div>
                      <h3>{product.name}</h3>
                      <p className="subtle-text">{product.description || "No description provided in CipherPay."}</p>
                    </div>
                    <p className="cipherpay-inline-code cipherpay-catalog-slug">{product.slug}</p>
                  </div>

                  {oneTimePrices.length ? (
                    <>
                      <div className="cipherpay-price-chip-row">
                        {oneTimePrices.map((price) => (
                          <button
                            className={`cipherpay-price-chip${selectedPrice?.id === price.id ? " cipherpay-price-chip-active" : ""}`}
                            key={price.id}
                            onClick={() => setSelectedPriceIds((current) => ({ ...current, [product.id]: price.id }))}
                            type="button"
                          >
                            {formatFiatAmount(price.unit_amount, price.currency)}
                          </button>
                        ))}
                      </div>

                      <p className="subtle-text">
                        {selectedPrice
                          ? `Selected ${formatFiatAmount(selectedPrice.unit_amount, selectedPrice.currency)} on CipherPay.`
                          : "Choose a price to create a checkout."}
                      </p>

                      <label className="cipherpay-field">
                        <span>Variant / size</span>
                        <input
                          className="cipherpay-input"
                          onChange={(event) =>
                            setCatalogVariants((current) => ({
                              ...current,
                              [product.id]: event.target.value,
                            }))
                          }
                          placeholder="Optional"
                          type="text"
                          value={catalogVariants[product.id] || ""}
                        />
                      </label>

                      <div className="button-row">
                        <button
                          className="button"
                          disabled={!selectedPrice || catalogSubmittingProductId === product.id}
                          onClick={() => void createCatalogCheckout(product)}
                          type="button"
                        >
                          {catalogSubmittingProductId === product.id ? "Creating…" : "Open checkout"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="subtle-text">No active one-time prices are available for this product yet.</p>
                  )}

                  {recurringPrices.length ? (
                    <div className="cipherpay-catalog-note">
                      {recurringPrices.map((price) => (
                        <p className="subtle-text" key={price.id}>
                          Recurring price available: {formatFiatAmount(price.unit_amount, price.currency)}{" "}
                          {recurringPriceSummary(price) ? `(${recurringPriceSummary(price)})` : ""}.
                        </p>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="cipherpay-section">
        <header className="cipherpay-section-header">
          <div>
            <h2>Manual invoice</h2>
            <p className="subtle-text">Fallback path for ad hoc testing when you want to create an invoice without using the CipherPay product catalog.</p>
          </div>
        </header>

        <form className="cipherpay-form" onSubmit={handleManualCheckout}>
          <div className="cipherpay-form-grid">
            <label className="cipherpay-field">
              <span>Product</span>
              <input className="cipherpay-input" onChange={(event) => setManualProductName(event.target.value)} type="text" value={manualProductName} />
            </label>

            <label className="cipherpay-field">
              <span>Amount</span>
              <input className="cipherpay-input" min="0.01" onChange={(event) => setManualAmount(event.target.value)} step="0.01" type="number" value={manualAmount} />
            </label>

            <label className="cipherpay-field">
              <span>Currency</span>
              <input className="cipherpay-input" maxLength={3} onChange={(event) => setManualCurrency(event.target.value.toUpperCase())} type="text" value={manualCurrency} />
            </label>

            <label className="cipherpay-field">
              <span>Variant / size</span>
              <input className="cipherpay-input" onChange={(event) => setManualSize(event.target.value)} placeholder="Optional" type="text" value={manualSize} />
            </label>
          </div>

          <div className="button-row">
            <button className="button" disabled={manualSubmitting || !manualCheckoutReady} type="submit">
              {manualSubmitting ? "Creating…" : "Create manual checkout"}
            </button>
            {!manualCheckoutReady ? <span className="subtle-text">Add an API key on the Admin tab before creating manual invoices.</span> : null}
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
