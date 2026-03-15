"use client";

import type { CipherPayNetwork, CipherPayTestSessionStatus } from "@/lib/cipherpay-test/types";

export async function readJsonOrThrow<T>(response: Response): Promise<T> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

export function cipherPayDefaultsForNetwork(network: CipherPayNetwork) {
  if (network === "mainnet") {
    return {
      apiBaseUrl: "https://api.cipherpay.app",
      checkoutBaseUrl: "https://cipherpay.app",
    };
  }

  return {
    apiBaseUrl: "https://api.testnet.cipherpay.app",
    checkoutBaseUrl: "https://testnet.cipherpay.app",
  };
}

export function cipherPayDashboardLoginUrl(checkoutBaseUrl: string | null | undefined, network: CipherPayNetwork): string {
  const fallback = cipherPayDefaultsForNetwork(network).checkoutBaseUrl;
  try {
    const origin = new URL((checkoutBaseUrl || fallback).trim()).origin;
    return `${origin}/en/dashboard/login`;
  } catch {
    return `${fallback}/en/dashboard/login`;
  }
}

export function cipherPayWebhookCallbackUrl(origin: string) {
  return `${origin.replace(/\/+$/, "")}/api/v1/cipherpay/webhook`;
}

export function cipherPayStatusLabel(status: CipherPayTestSessionStatus): string {
  return status.replaceAll("_", " ");
}

export function cipherPayStatusClassName(status: CipherPayTestSessionStatus): string {
  if (status === "confirmed") return "cipherpay-status cipherpay-status-confirmed";
  if (status === "detected") return "cipherpay-status cipherpay-status-detected";
  if (status === "underpaid" || status === "pending" || status === "draft") {
    return "cipherpay-status cipherpay-status-pending";
  }
  if (status === "expired" || status === "refunded") return "cipherpay-status cipherpay-status-expired";
  return "cipherpay-status";
}

export function formatFiatAmount(amount: number | null, currency: string | null): string {
  if (amount == null || !currency) return "n/a";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
