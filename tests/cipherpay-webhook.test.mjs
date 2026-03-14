import test from "node:test";
import assert from "node:assert/strict";
import {
  CIPHERPAY_WEBHOOK_TOLERANCE_MS,
  computeCipherPayWebhookSignature,
  verifyCipherPayWebhookSignature,
} from "../shared/cipherpay-test/webhook.mjs";
import { maybeProxyApiRequest } from "../lib/xmonitor/backend-api.ts";

test("verifyCipherPayWebhookSignature accepts a valid signature inside the replay window", () => {
  const timestamp = "2026-03-14T12:00:00.000Z";
  const body = JSON.stringify({
    event: "confirmed",
    invoice_id: "inv_test_123",
  });
  const secret = "whsec_test_123";
  const signature = computeCipherPayWebhookSignature({ timestamp, body, secret });

  const result = verifyCipherPayWebhookSignature({
    timestamp,
    signature,
    body,
    secret,
    nowMs: new Date("2026-03-14T12:04:59.000Z").getTime(),
  });

  assert.equal(result.ok, true);
});

test("verifyCipherPayWebhookSignature rejects stale timestamps", () => {
  const timestamp = "2026-03-14T12:00:00.000Z";
  const body = JSON.stringify({
    event: "confirmed",
    invoice_id: "inv_test_456",
  });
  const secret = "whsec_test_456";
  const signature = computeCipherPayWebhookSignature({ timestamp, body, secret });

  const result = verifyCipherPayWebhookSignature({
    timestamp,
    signature,
    body,
    secret,
    nowMs: new Date("2026-03-14T12:00:00.000Z").getTime() + CIPHERPAY_WEBHOOK_TOLERANCE_MS + 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "timestamp_out_of_range");
});

test("verifyCipherPayWebhookSignature rejects mismatched signatures", () => {
  const result = verifyCipherPayWebhookSignature({
    timestamp: "2026-03-14T12:00:00.000Z",
    signature: "bad-signature",
    body: JSON.stringify({ event: "confirmed" }),
    secret: "whsec_test_789",
    nowMs: new Date("2026-03-14T12:00:01.000Z").getTime(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("maybeProxyApiRequest forwards CipherPay webhook headers to the backend", async () => {
  const originalBaseUrl = process.env.XMONITOR_BACKEND_API_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.XMONITOR_BACKEND_API_BASE_URL = "https://backend.example";

  let forwardedUrl = null;
  let forwardedHeaders = null;
  let forwardedBody = null;

  globalThis.fetch = async (url, init) => {
    forwardedUrl = String(url);
    forwardedHeaders = new Headers(init?.headers);
    forwardedBody = init?.body ? Buffer.from(init.body).toString("utf8") : null;
    return new Response(JSON.stringify({ ok: true }), {
      status: 202,
      headers: {
        "content-type": "application/json",
      },
    });
  };

  try {
    const request = new Request("https://www.zodldashboard.com/api/v1/cipherpay/webhook?source=test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cipherpay-signature": "sig_test_123",
        "x-cipherpay-timestamp": "2026-03-14T12:00:00.000Z",
        "x-forwarded-for": "203.0.113.10",
        "user-agent": "CipherPay-Test/1.0",
      },
      body: JSON.stringify({ invoice_id: "inv_test_proxy" }),
    });

    const response = await maybeProxyApiRequest(request);

    assert.ok(response);
    assert.equal(response.status, 202);
    assert.equal(forwardedUrl, "https://backend.example/v1/cipherpay/webhook?source=test");
    assert.equal(forwardedHeaders?.get("x-cipherpay-signature"), "sig_test_123");
    assert.equal(forwardedHeaders?.get("x-cipherpay-timestamp"), "2026-03-14T12:00:00.000Z");
    assert.equal(forwardedHeaders?.get("x-forwarded-for"), "203.0.113.10");
    assert.equal(forwardedHeaders?.get("user-agent"), "CipherPay-Test/1.0");
    assert.equal(forwardedBody, JSON.stringify({ invoice_id: "inv_test_proxy" }));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.XMONITOR_BACKEND_API_BASE_URL;
    } else {
      process.env.XMONITOR_BACKEND_API_BASE_URL = originalBaseUrl;
    }
  }
});
