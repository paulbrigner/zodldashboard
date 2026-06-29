import { createAdapterFactory } from "better-auth/adapters";
import { backendApiBaseUrl } from "@/lib/xmonitor/backend-api";

const PROXY_SECRET_HEADER = "x-xmonitor-viewer-secret";
const DEFAULT_TIMEOUT_MS = 10_000;

type AdapterOperation =
  | "create"
  | "findOne"
  | "findMany"
  | "count"
  | "update"
  | "updateMany"
  | "delete"
  | "deleteMany"
  | "consumeOne"
  | "incrementOne";

type AdapterBackendResponse<T> = {
  ok?: boolean;
  result?: T;
  error?: string;
};

function trimValue(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function proxySecret(): string | null {
  return trimValue(process.env.XMONITOR_USER_PROXY_SECRET);
}

function requestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.BETTER_AUTH_ADAPTER_PROXY_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function hasBetterAuthProxyAdapterConfig(): boolean {
  return Boolean(backendApiBaseUrl() && proxySecret());
}

async function callAdapterBackend<T>(operation: AdapterOperation, payload: Record<string, unknown>): Promise<T> {
  const baseUrl = backendApiBaseUrl();
  const secret = proxySecret();
  if (!baseUrl || !secret) {
    throw new Error("Better Auth adapter proxy requires XMONITOR_BACKEND_API_BASE_URL and XMONITOR_USER_PROXY_SECRET.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}/auth/better-auth/adapter`, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        [PROXY_SECRET_HEADER]: secret,
      },
      body: JSON.stringify({ operation, ...payload }),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    let body: AdapterBackendResponse<T> | null = null;
    try {
      body = rawBody ? (JSON.parse(rawBody) as AdapterBackendResponse<T>) : null;
    } catch {
      body = null;
    }

    if (!response.ok) {
      const detail = body?.error || rawBody.trim().slice(0, 240);
      throw new Error(`Better Auth adapter backend failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }

    if (!body || !("result" in body)) {
      throw new Error("Better Auth adapter backend returned an invalid response.");
    }

    return body.result as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const betterAuthProxyAdapter = createAdapterFactory({
  config: {
    adapterId: "zodldashboard-vpc-better-auth",
    adapterName: "ZODL VPC Better Auth",
    supportsBooleans: true,
    supportsDates: false,
    supportsJSON: false,
    supportsArrays: false,
    supportsNumericIds: false,
    transaction: false,
  },
  adapter: () => ({
    create: (data) => callAdapterBackend("create", data),
    findOne: (data) => callAdapterBackend("findOne", data),
    findMany: (data) => callAdapterBackend("findMany", data),
    count: (data) => callAdapterBackend("count", data),
    update: (data) => callAdapterBackend("update", data),
    updateMany: (data) => callAdapterBackend("updateMany", data),
    delete: async (data) => {
      await callAdapterBackend("delete", data);
    },
    deleteMany: (data) => callAdapterBackend("deleteMany", data),
    consumeOne: (data) => callAdapterBackend("consumeOne", data),
    incrementOne: (data) => callAdapterBackend("incrementOne", data),
  }),
});
