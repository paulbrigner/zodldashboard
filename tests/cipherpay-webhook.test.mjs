import test from "node:test";
import assert from "node:assert/strict";
import {
  CIPHERPAY_WEBHOOK_TOLERANCE_MS,
  computeCipherPayWebhookSignature,
  verifyCipherPayWebhookSignature,
} from "../shared/cipherpay-test/webhook.mjs";

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
