"use client";

import { FormEvent, useEffect, useState } from "react";
import type { CipherPayNetwork, CipherPayTestConfig } from "@/lib/cipherpay-test/types";
import { LocalDateTime } from "../../components/local-date-time";
import {
  cipherPayDefaultsForNetwork,
  cipherPayWebhookCallbackUrl,
  formatFiatAmount,
  readJsonOrThrow,
} from "../client-utils";

type ConfigResponse = {
  config: CipherPayTestConfig;
};

export function CipherPayTestAdminClient() {
  const [config, setConfig] = useState<CipherPayTestConfig | null>(null);
  const [network, setNetwork] = useState<CipherPayNetwork>("testnet");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [checkoutBaseUrl, setCheckoutBaseUrl] = useState("");
  const [defaultProductName, setDefaultProductName] = useState("CipherPay Test Purchase");
  const [defaultAmount, setDefaultAmount] = useState("1.00");
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [origin, setOrigin] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadConfig() {
    setLoading(true);
    setError(null);
    try {
      const response = await readJsonOrThrow<ConfigResponse>(await fetch("/api/v1/cipherpay/config", { cache: "no-store" }));
      const nextConfig = response.config;
      setConfig(nextConfig);
      setNetwork(nextConfig.network);
      setApiBaseUrl(nextConfig.api_base_url);
      setCheckoutBaseUrl(nextConfig.checkout_base_url);
      setDefaultProductName(nextConfig.default_product_name);
      setDefaultAmount(nextConfig.default_amount.toFixed(2));
      setDefaultCurrency(nextConfig.default_currency);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load CipherPay Test config");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setOrigin(window.location.origin);
    void loadConfig();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const payload: Record<string, string | number> = {
        network,
        api_base_url: apiBaseUrl,
        checkout_base_url: checkoutBaseUrl,
        default_product_name: defaultProductName,
        default_amount: Number(defaultAmount),
        default_currency: defaultCurrency.toUpperCase(),
      };
      if (apiKey.trim()) payload.api_key = apiKey.trim();
      if (webhookSecret.trim()) payload.webhook_secret = webhookSecret.trim();

      const response = await readJsonOrThrow<ConfigResponse>(
        await fetch("/api/v1/cipherpay/config", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        })
      );

      setConfig(response.config);
      setApiKey("");
      setWebhookSecret("");
      setNotice("CipherPay Test config saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save CipherPay Test config");
    } finally {
      setSaving(false);
    }
  }

  const webhookUrl = origin ? cipherPayWebhookCallbackUrl(origin) : "/api/v1/cipherpay/webhook";

  return (
    <div className="cipherpay-page-body">
      <section className="cipherpay-section">
        <header className="cipherpay-section-header">
          <div>
            <h2>Admin</h2>
            <p className="subtle-text">Store the test harness settings CipherPay needs: environment, API base URLs, API key, and webhook secret.</p>
          </div>
        </header>

        {loading ? <p className="subtle-text">Loading config…</p> : null}
        {error ? <p className="cipherpay-error-text">{error}</p> : null}
        {notice ? <p className="cipherpay-valid-text">{notice}</p> : null}

        <div className="cipherpay-card-grid">
          <article className="cipherpay-detail-card">
            <h3>Webhook callback</h3>
            <p className="cipherpay-inline-code">{webhookUrl}</p>
            <p className="subtle-text">
              Save this as your CipherPay webhook URL. Testnet accepts `http://` during local development, but the deployed dashboard is already HTTPS.
            </p>
          </article>

          <article className="cipherpay-detail-card">
            <h3>Stored secret previews</h3>
            <p className="subtle-text">API key: {config?.api_key_preview || "not stored yet"}</p>
            <p className="subtle-text">Webhook secret: {config?.webhook_secret_preview || "not stored yet"}</p>
            <p className="subtle-text">
              Last updated {config?.updated_at ? <LocalDateTime iso={config.updated_at} /> : "never"} by {config?.updated_by_email || "n/a"}.
            </p>
          </article>

          <article className="cipherpay-detail-card">
            <h3>Default storefront ticket</h3>
            <p>{formatFiatAmount(config?.default_amount ?? null, config?.default_currency ?? null)}</p>
            <p className="subtle-text">{config?.default_product_name || "CipherPay Test Purchase"}</p>
          </article>
        </div>
      </section>

      <section className="cipherpay-section">
        <header className="cipherpay-section-header">
          <div>
            <h2>Configuration</h2>
            <p className="subtle-text">Leave secret fields blank to keep the currently stored values. Switching networks will load the documented default API and checkout URLs.</p>
          </div>
        </header>

        <form className="cipherpay-form" onSubmit={handleSubmit}>
          <div className="cipherpay-form-grid">
            <label className="cipherpay-field">
              <span>Network</span>
              <select
                className="cipherpay-input"
                onChange={(event) => {
                  const nextNetwork = event.target.value as CipherPayNetwork;
                  const defaults = cipherPayDefaultsForNetwork(nextNetwork);
                  setNetwork(nextNetwork);
                  setApiBaseUrl(defaults.apiBaseUrl);
                  setCheckoutBaseUrl(defaults.checkoutBaseUrl);
                }}
                value={network}
              >
                <option value="testnet">Testnet</option>
                <option value="mainnet">Mainnet</option>
              </select>
            </label>

            <label className="cipherpay-field">
              <span>API base URL</span>
              <input className="cipherpay-input" onChange={(event) => setApiBaseUrl(event.target.value)} type="url" value={apiBaseUrl} />
            </label>

            <label className="cipherpay-field">
              <span>Checkout base URL</span>
              <input
                className="cipherpay-input"
                onChange={(event) => setCheckoutBaseUrl(event.target.value)}
                type="url"
                value={checkoutBaseUrl}
              />
            </label>

            <label className="cipherpay-field">
              <span>Default product name</span>
              <input
                className="cipherpay-input"
                onChange={(event) => setDefaultProductName(event.target.value)}
                type="text"
                value={defaultProductName}
              />
            </label>

            <label className="cipherpay-field">
              <span>Default amount</span>
              <input className="cipherpay-input" min="0.01" onChange={(event) => setDefaultAmount(event.target.value)} step="0.01" type="number" value={defaultAmount} />
            </label>

            <label className="cipherpay-field">
              <span>Default currency</span>
              <input className="cipherpay-input" maxLength={3} onChange={(event) => setDefaultCurrency(event.target.value.toUpperCase())} type="text" value={defaultCurrency} />
            </label>
          </div>

          <div className="cipherpay-form-grid">
            <label className="cipherpay-field">
              <span>API key</span>
              <input
                className="cipherpay-input"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={config?.has_api_key ? "Stored server-side. Paste a new key to replace it." : "cpay_sk_..."}
                type="password"
                value={apiKey}
              />
            </label>

            <label className="cipherpay-field">
              <span>Webhook secret</span>
              <input
                className="cipherpay-input"
                onChange={(event) => setWebhookSecret(event.target.value)}
                placeholder={config?.has_webhook_secret ? "Stored server-side. Paste a new secret to replace it." : "whsec_..."}
                type="password"
                value={webhookSecret}
              />
            </label>
          </div>

          <div className="button-row">
            <button className="button" disabled={saving} type="submit">
              {saving ? "Saving…" : "Save config"}
            </button>
            <button className="button button-secondary" disabled={loading || saving} onClick={() => void loadConfig()} type="button">
              Reload
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
