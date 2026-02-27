import { cache } from "react";
import bundledData from "@/data/regulatory-risk/data_bundle_v1_1.json";
import type { RegulatoryRiskDataBundle } from "./types";

export type RegulatoryRiskDataSource = "local" | "remote";

export type RegulatoryRiskDataResult = {
  bundle: RegulatoryRiskDataBundle;
  source: RegulatoryRiskDataSource;
  dataUrl: string | null;
  warning: string | null;
};

const TOP_LEVEL_KEYS: Array<keyof RegulatoryRiskDataBundle> = [
  "meta",
  "tiers",
  "jurisdictions",
  "feature_catalog",
  "guardrails",
  "internal_processes",
  "operating_policy",
  "signals",
  "recommendation_rules",
  "task_backlog",
  "change_log",
  "review_schedule",
];

const LOCAL_FALLBACK = bundledData as RegulatoryRiskDataBundle;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasTopLevelContract(value: unknown): value is RegulatoryRiskDataBundle {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  return TOP_LEVEL_KEYS.every((key) => key in record);
}

function parseBundle(value: unknown): RegulatoryRiskDataBundle {
  if (!hasTopLevelContract(value)) {
    throw new Error("Regulatory risk data payload is missing required top-level keys");
  }
  return value;
}

function getConfiguredDataUrl(): string | null {
  const dataUrl = process.env.REGULATORY_RISK_DATA_URL?.trim();
  if (dataUrl) {
    return dataUrl;
  }

  const genericDataUrl = process.env.DATA_URL?.trim();
  return genericDataUrl || null;
}

async function fetchRuntimeBundle(dataUrl: string): Promise<RegulatoryRiskDataBundle> {
  const response = await fetch(dataUrl, {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Data URL request failed (${response.status})`);
  }

  const payload = (await response.json()) as unknown;
  return parseBundle(payload);
}

export const getRegulatoryRiskData = cache(async (): Promise<RegulatoryRiskDataResult> => {
  const dataUrl = getConfiguredDataUrl();
  if (!dataUrl) {
    return {
      bundle: LOCAL_FALLBACK,
      source: "local",
      dataUrl: null,
      warning: null,
    };
  }

  try {
    const bundle = await fetchRuntimeBundle(dataUrl);
    return {
      bundle,
      source: "remote",
      dataUrl,
      warning: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      bundle: LOCAL_FALLBACK,
      source: "local",
      dataUrl,
      warning: `Could not load runtime DATA_URL (${message}). Showing bundled fallback data.`,
    };
  }
});
