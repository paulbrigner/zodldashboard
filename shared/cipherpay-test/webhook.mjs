import { createHmac } from "node:crypto";

export const CIPHERPAY_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

function isoTimestampMs(value) {
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) ? time : null;
}

export function computeCipherPayWebhookSignature({ timestamp, body, secret }) {
  return createHmac("sha256", String(secret || ""))
    .update(`${String(timestamp || "")}.${String(body || "")}`, "utf8")
    .digest("hex");
}

export function verifyCipherPayWebhookSignature({
  timestamp,
  signature,
  body,
  secret,
  nowMs = Date.now(),
  toleranceMs = CIPHERPAY_WEBHOOK_TOLERANCE_MS,
}) {
  if (!secret) {
    return { ok: false, reason: "missing_secret" };
  }
  if (!signature) {
    return { ok: false, reason: "missing_signature" };
  }
  if (!timestamp) {
    return { ok: false, reason: "missing_timestamp" };
  }

  const timestampMs = isoTimestampMs(timestamp);
  if (timestampMs === null) {
    return { ok: false, reason: "invalid_timestamp" };
  }

  const ageMs = Math.abs(nowMs - timestampMs);
  if (ageMs > toleranceMs) {
    return { ok: false, reason: "timestamp_out_of_range", age_ms: ageMs };
  }

  const expected = computeCipherPayWebhookSignature({ timestamp, body, secret });
  if (String(signature) !== expected) {
    return { ok: false, reason: "signature_mismatch" };
  }

  return { ok: true, age_ms: ageMs };
}
