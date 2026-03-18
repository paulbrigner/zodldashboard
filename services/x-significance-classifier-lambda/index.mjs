const DEFAULT_INGEST_API_BASE_URL = "https://www.zodldashboard.com/api/v1";
const DEFAULT_SIGNIFICANCE_LLM_URL = "https://api.venice.ai/api/v1";
const DEFAULT_SIGNIFICANCE_LLM_MODEL = "google-gemma-3-27b-it";

function asString(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function asBool(value, fallback) {
  if (typeof value === "boolean") return value;
  const text = asString(value).toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function asPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function asFiniteFloat(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSubstanceText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[$#]([A-Za-z0-9_]+)/g, " $1 ")
    .replace(/@[A-Za-z0-9_][A-Za-z0-9_.]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmptyOrStubText(text) {
  return !normalizeSubstanceText(text);
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function computeAccountAgeDays(accountCreatedAt, observedAt) {
  const createdMs = Date.parse(String(accountCreatedAt || ""));
  const observedMs = Date.parse(String(observedAt || ""));
  if (!Number.isFinite(createdMs) || !Number.isFinite(observedMs) || observedMs < createdMs) {
    return null;
  }
  return Math.floor((observedMs - createdMs) / 86400000);
}

function getConfig(event = {}) {
  return {
    enabled: asBool(process.env.XMON_SIGNIFICANCE_ENABLED, true),
    ingestApiBaseUrl: (asString(process.env.XMON_SIGNIFICANCE_INGEST_API_BASE_URL) || DEFAULT_INGEST_API_BASE_URL).replace(/\/+$/, ""),
    ingestApiKey: asString(process.env.XMON_SIGNIFICANCE_INGEST_API_KEY || process.env.XMONITOR_INGEST_SHARED_SECRET),
    ingestTimeoutMs: asPositiveInt(process.env.XMON_SIGNIFICANCE_INGEST_TIMEOUT_MS, 20000),
    llmUrl: (asString(process.env.XMON_SIGNIFICANCE_LLM_URL) || DEFAULT_SIGNIFICANCE_LLM_URL).replace(/\/+$/, ""),
    llmModel: asString(process.env.XMON_SIGNIFICANCE_LLM_MODEL) || DEFAULT_SIGNIFICANCE_LLM_MODEL,
    llmApiKey: asString(process.env.XMON_SIGNIFICANCE_LLM_API_KEY),
    llmTemperature: asFiniteFloat(process.env.XMON_SIGNIFICANCE_LLM_TEMPERATURE, 0),
    llmMaxTokens: asPositiveInt(process.env.XMON_SIGNIFICANCE_LLM_MAX_TOKENS, 1400),
    llmTimeoutMs: asPositiveInt(process.env.XMON_SIGNIFICANCE_LLM_TIMEOUT_MS, 120000),
    llmMaxAttempts: asPositiveInt(process.env.XMON_SIGNIFICANCE_LLM_MAX_ATTEMPTS, 3),
    llmInitialBackoffMs: asPositiveInt(process.env.XMON_SIGNIFICANCE_LLM_INITIAL_BACKOFF_MS, 1000),
    batchSize: Math.min(Math.max(asPositiveInt(event.batch_size ?? process.env.XMON_SIGNIFICANCE_BATCH_SIZE, 4), 1), 24),
    maxPostsPerRun: Math.min(Math.max(asPositiveInt(event.max_posts_per_run ?? process.env.XMON_SIGNIFICANCE_MAX_POSTS_PER_RUN, 24), 1), 500),
    maxAttempts: Math.min(Math.max(asPositiveInt(event.max_attempts ?? process.env.XMON_SIGNIFICANCE_MAX_ATTEMPTS, 3), 1), 10),
    leaseSeconds: Math.min(Math.max(asPositiveInt(event.lease_seconds ?? process.env.XMON_SIGNIFICANCE_LEASE_SECONDS, 300), 30), 3600),
    significanceVersion: asString(process.env.XMON_SIGNIFICANCE_VERSION) || "ai_v2",
  };
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      throw new Error(`request failed (${response.status}): ${text.slice(0, 400)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function postJsonWithTimeout(url, apiKey, payload, timeoutMs) {
  return fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "user-agent": "xmonitor-significance-classifier/1.0",
      },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );
}

function extractCompletionText(payload) {
  if (!payload || typeof payload !== "object") return "";

  const direct = asString(payload.output_text) || asString(payload.content);
  if (direct) return direct;

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    const content = choice?.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const parts = content
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item.text === "string") return item.text;
          if (item && typeof item.output_text === "string") return item.output_text;
          return "";
        })
        .filter(Boolean);
      if (parts.length > 0) {
        return parts.join("\n").trim();
      }
    }
  }

  return "";
}

function buildClassificationMessages(items) {
  return [
    {
      role: "system",
      content:
        "You classify X posts for a Zcash monitoring dashboard. "
        + "A post is significant only if it is likely worth operator attention because it contains material product, governance, ecosystem, regulatory, security, adoption, or strategy information or informed commentary. "
        + "Not significant includes casual chatter, memes, hype, generic market talk, incidental mentions, low-information replies, and routine reactions. "
        + "Use only the provided text and metadata. Do not use likes, reposts, replies, or views. "
        + "High follower counts and long-established accounts can raise significance when the post is relevant, substantive, or likely to influence the conversation, but they are supporting signals rather than automatic overrides. "
        + "Location can matter when it adds regulatory, geographic, or ecosystem context, but free-form profile locations are often noisy. "
        + "Watchlist/source metadata is context, not an automatic reason to mark a post significant. "
        + "Return concise reasons.",
    },
    {
      role: "user",
      content: JSON.stringify({
        instruction: "Classify every item. Return one result for each status_id.",
        items: items.map((item) => ({
          status_id: item.status_id,
          author_handle: item.author_handle,
          author_display: item.author_display || null,
          followers_count: item.followers_count ?? null,
          account_created_at: toIso(item.account_created_at),
          account_age_days_at_capture: computeAccountAgeDays(item.account_created_at, item.discovered_at),
          author_location: item.author_location || null,
          watch_tier: item.watch_tier || null,
          source_query: item.source_query || null,
          discovered_at: item.discovered_at,
          body_text: item.body_text || "",
        })),
      }),
    },
  ];
}

function classificationResponseSchema() {
  return {
    type: "json_schema",
    json_schema: {
      name: "xmonitor_significance_batch",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["items"],
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["status_id", "significant", "confidence", "reason"],
              properties: {
                status_id: { type: "string" },
                significant: { type: "boolean" },
                confidence: { type: "number" },
                reason: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
}

async function requestBatchClassification(config, items) {
  const payload = await fetchJsonWithTimeout(
    `${config.llmUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.llmApiKey}`,
        "content-type": "application/json",
        "user-agent": "xmonitor-significance-classifier/1.0",
      },
      body: JSON.stringify({
        model: config.llmModel,
        messages: buildClassificationMessages(items),
        temperature: config.llmTemperature,
        max_tokens: config.llmMaxTokens,
        response_format: classificationResponseSchema(),
      }),
    },
    config.llmTimeoutMs
  );

  const text = extractCompletionText(payload);
  if (!text) {
    throw new Error("significance classifier returned empty response");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("significance classifier returned invalid JSON");
  }

  const rawItems = Array.isArray(parsed?.items) ? parsed.items : null;
  if (!rawItems) {
    throw new Error("significance classifier response missing items");
  }

  const byStatusId = new Map();
  for (const item of rawItems) {
    const statusId = asString(item?.status_id);
    const significant = typeof item?.significant === "boolean" ? item.significant : null;
    const confidence = Number(item?.confidence);
    const reason = asString(item?.reason);
    if (!statusId || significant === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !reason) {
      throw new Error("significance classifier response item is invalid");
    }
    byStatusId.set(statusId, {
      status_id: statusId,
      classification_status: "classified",
      is_significant: significant,
      significance_reason: reason,
      classification_confidence: confidence,
      classification_model: config.llmModel,
      significance_version: config.significanceVersion,
      classified_at: nowIso(),
    });
  }

  if (byStatusId.size !== items.length) {
    throw new Error("significance classifier response length mismatch");
  }

  return items.map((item) => {
    const match = byStatusId.get(item.status_id);
    if (!match) {
      throw new Error(`significance classifier omitted status_id ${item.status_id}`);
    }
    return match;
  });
}

async function requestBatchClassificationWithRetry(config, items) {
  let lastError = null;
  for (let attempt = 1; attempt <= config.llmMaxAttempts; attempt += 1) {
    try {
      return await requestBatchClassification(config, items);
    } catch (error) {
      lastError = error;
      if (attempt < config.llmMaxAttempts) {
        await sleep(config.llmInitialBackoffMs * (2 ** (attempt - 1)));
      }
    }
  }
  throw lastError || new Error("significance classifier failed");
}

async function claimPosts(config) {
  const response = await postJsonWithTimeout(
    `${config.ingestApiBaseUrl}/ingest/significance/claim`,
    config.ingestApiKey,
    {
      limit: config.maxPostsPerRun,
      lease_seconds: config.leaseSeconds,
      max_attempts: config.maxAttempts,
    },
    config.ingestTimeoutMs
  );
  return Array.isArray(response?.items) ? response.items : [];
}

async function applyResults(config, items) {
  return postJsonWithTimeout(
    `${config.ingestApiBaseUrl}/ingest/significance/batch`,
    config.ingestApiKey,
    { items },
    config.ingestTimeoutMs
  );
}

export async function handler(event = {}) {
  const config = getConfig(event);

  if (!config.enabled) {
    return { ok: true, skipped: "disabled", ran_at: nowIso() };
  }
  if (!config.ingestApiKey) {
    throw new Error("missing significance ingest API key");
  }
  if (!config.llmApiKey) {
    throw new Error("missing significance LLM API key");
  }

  const claimed = await claimPosts(config);
  if (claimed.length === 0) {
    return {
      ok: true,
      claimed: 0,
      classified: 0,
      failed: 0,
      hard_rejected: 0,
      ai_batches: 0,
      model: config.llmModel,
      ran_at: nowIso(),
    };
  }

  const hardRejected = [];
  const aiCandidates = [];
  for (const item of claimed) {
    if (isEmptyOrStubText(item?.body_text || "")) {
      hardRejected.push({
        status_id: item.status_id,
        classification_status: "classified",
        is_significant: false,
        significance_reason: "empty_or_stub_text",
        significance_version: config.significanceVersion,
        classification_model: "hard_reject",
        classification_confidence: 1,
        classified_at: nowIso(),
      });
    } else {
      aiCandidates.push(item);
    }
  }

  const resultItems = [...hardRejected];
  let failed = 0;
  let aiBatches = 0;

  for (const batch of chunkArray(aiCandidates, config.batchSize)) {
    try {
      const batchResults = await requestBatchClassificationWithRetry(config, batch);
      resultItems.push(...batchResults);
      aiBatches += 1;
    } catch (error) {
      failed += batch.length;
      const message = error instanceof Error ? error.message : "significance_classifier_failed";
      resultItems.push(
        ...batch.map((item) => ({
          status_id: item.status_id,
          classification_status: "failed",
          significance_version: config.significanceVersion,
          classification_model: config.llmModel,
          classification_error: message,
        }))
      );
    }
  }

  const ingestResult = await applyResults(config, resultItems);

  return {
    ok: true,
    claimed: claimed.length,
    classified: resultItems.filter((item) => item.classification_status === "classified").length,
    failed,
    hard_rejected: hardRejected.length,
    ai_batches: aiBatches,
    model: config.llmModel,
    ingest: {
      updated: Number(ingestResult?.updated || 0),
      skipped: Number(ingestResult?.skipped || 0),
      errors: Array.isArray(ingestResult?.errors) ? ingestResult.errors : [],
    },
    ran_at: nowIso(),
  };
}
