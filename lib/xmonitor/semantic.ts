const DEFAULT_EMBEDDING_BASE_URL = "https://api.venice.ai/api/v1";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-bge-m3";
const DEFAULT_EMBEDDING_DIMS = 1024;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 10000;

function asString(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const text = asString(value);
  if (!text) return fallback;
  const normalized = text.toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return fallback;
}

export function semanticEnabled(): boolean {
  return parseBoolean(process.env.XMONITOR_SEMANTIC_ENABLED, true);
}

export function embeddingBaseUrl(): string {
  const configured = asString(process.env.XMONITOR_EMBEDDING_BASE_URL);
  return (configured || DEFAULT_EMBEDDING_BASE_URL).replace(/\/+$/, "");
}

export function embeddingModel(): string {
  return asString(process.env.XMONITOR_EMBEDDING_MODEL) || DEFAULT_EMBEDDING_MODEL;
}

export function embeddingDims(): number {
  return parsePositiveInt(process.env.XMONITOR_EMBEDDING_DIMS, DEFAULT_EMBEDDING_DIMS);
}

export function embeddingTimeoutMs(): number {
  return parsePositiveInt(process.env.XMONITOR_EMBEDDING_TIMEOUT_MS, DEFAULT_EMBEDDING_TIMEOUT_MS);
}

export function embeddingApiKey(): string | null {
  return asString(process.env.XMONITOR_EMBEDDING_API_KEY) || asString(process.env.VENICE_API_KEY);
}

export async function createQueryEmbedding(queryText: string): Promise<number[]> {
  const apiKey = embeddingApiKey();
  if (!apiKey) {
    throw new Error("embedding API key is not configured. Set XMONITOR_EMBEDDING_API_KEY.");
  }

  const endpoint = `${embeddingBaseUrl()}/embeddings`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), embeddingTimeoutMs());

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: embeddingModel(),
        input: queryText,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        // ignore
      }
      const snippet = (detail || "").trim().split("\n")[0]?.slice(0, 240);
      throw new Error(`embedding request failed (${response.status})${snippet ? `: ${snippet}` : ""}`);
    }

    const payload = (await response.json()) as { data?: Array<{ embedding?: unknown }> };
    const vector = payload?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("embedding response missing data[0].embedding");
    }

    const parsed = vector.map((value) => Number(value));
    if (parsed.some((value) => !Number.isFinite(value))) {
      throw new Error("embedding vector contains non-numeric values");
    }

    if (parsed.length !== embeddingDims()) {
      throw new Error(`embedding dimension mismatch: expected ${embeddingDims()}, got ${parsed.length}`);
    }

    return parsed;
  } finally {
    clearTimeout(timeoutId);
  }
}
