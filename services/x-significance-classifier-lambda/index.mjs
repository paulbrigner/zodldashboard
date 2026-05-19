const DEFAULT_INGEST_API_BASE_URL = "https://www.zodldashboard.com/api/v1";
const DEFAULT_SIGNIFICANCE_LLM_URL = "https://api.venice.ai/api/v1";
const DEFAULT_SIGNIFICANCE_LLM_MODEL = "qwen3-235b-a22b-instruct-2507";
const DEFAULT_SIGNIFICANCE_LLM_MAX_TOKENS = 900;
const DEFAULT_SIGNIFICANCE_LLM_TIMEOUT_MS = 30000;
const DEFAULT_SIGNIFICANCE_LLM_MAX_ATTEMPTS = 1;
const DEFAULT_SIGNIFICANCE_BATCH_SIZE = 1;
const DEFAULT_SIGNIFICANCE_MAX_POSTS_PER_RUN = 8;
const DEFAULT_SIGNIFICANCE_MAX_ATTEMPTS = 10;
const DEFAULT_LAMBDA_SAFETY_MARGIN_MS = 10000;
const METRIC_NAMESPACE = "XMonitor/Classifier";

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

function elapsedMs(startMs) {
  return Math.max(0, Date.now() - startMs);
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "unknown_error");
}

function remainingTimeMs(context) {
  if (context && typeof context.getRemainingTimeInMillis === "function") {
    const value = Number(context.getRemainingTimeInMillis());
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

function finiteRemainingTimeMs(context) {
  const value = remainingTimeMs(context);
  return Number.isFinite(value) ? value : null;
}

function isVeniceApiUrl(value) {
  return asString(value).toLowerCase().includes("venice.ai");
}

function hasTimeForLlmBatch(config, context) {
  return remainingTimeMs(context) > config.llmTimeoutMs + config.ingestTimeoutMs + config.lambdaSafetyMarginMs;
}

function sampleStatusIds(items, limit = 10) {
  return items.slice(0, limit).map((item) => String(item.status_id || "")).filter(Boolean);
}

function logStructured(level, event, fields = {}) {
  console.log(JSON.stringify({ level, event, at: nowIso(), ...fields }));
}

function metricUnit(name) {
  if (name.endsWith("Ms")) return "Milliseconds";
  if (name.endsWith("Seconds")) return "Seconds";
  return "Count";
}

function emitMetrics(metrics) {
  const cleanMetrics = {};
  for (const [key, value] of Object.entries(metrics)) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) cleanMetrics[key] = numericValue;
  }
  if (Object.keys(cleanMetrics).length === 0) return;

  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: METRIC_NAMESPACE,
          Dimensions: [["FunctionName"]],
          Metrics: Object.keys(cleanMetrics).map((name) => ({ Name: name, Unit: metricUnit(name) })),
        },
      ],
    },
    FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME || "xmonitor-x-significance-classifier",
    ...cleanMetrics,
  }));
}

function backlogMetrics(backlog) {
  if (!backlog || typeof backlog !== "object") return {};
  return {
    PendingClassificationCount: backlog.pending_count,
    ProcessingClassificationCount: backlog.processing_count,
    FailedClassificationCount: backlog.failed_count,
    RetryableClassificationCount: backlog.retryable_count,
    OldestPendingAgeSeconds: backlog.oldest_retryable_age_seconds,
  };
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
    llmMaxTokens: asPositiveInt(process.env.XMON_SIGNIFICANCE_LLM_MAX_TOKENS, DEFAULT_SIGNIFICANCE_LLM_MAX_TOKENS),
    llmTimeoutMs: asPositiveInt(process.env.XMON_SIGNIFICANCE_LLM_TIMEOUT_MS, DEFAULT_SIGNIFICANCE_LLM_TIMEOUT_MS),
    llmMaxAttempts: asPositiveInt(process.env.XMON_SIGNIFICANCE_LLM_MAX_ATTEMPTS, DEFAULT_SIGNIFICANCE_LLM_MAX_ATTEMPTS),
    llmInitialBackoffMs: asPositiveInt(process.env.XMON_SIGNIFICANCE_LLM_INITIAL_BACKOFF_MS, 1000),
    llmDisableThinking: asBool(event.disable_thinking ?? process.env.XMON_SIGNIFICANCE_DISABLE_THINKING, true),
    batchSize: Math.min(Math.max(asPositiveInt(event.batch_size ?? process.env.XMON_SIGNIFICANCE_BATCH_SIZE, DEFAULT_SIGNIFICANCE_BATCH_SIZE), 1), 24),
    maxPostsPerRun: Math.min(Math.max(asPositiveInt(event.max_posts_per_run ?? process.env.XMON_SIGNIFICANCE_MAX_POSTS_PER_RUN, DEFAULT_SIGNIFICANCE_MAX_POSTS_PER_RUN), 1), 500),
    maxAttempts: Math.min(Math.max(asPositiveInt(event.max_attempts ?? process.env.XMON_SIGNIFICANCE_MAX_ATTEMPTS, DEFAULT_SIGNIFICANCE_MAX_ATTEMPTS), 1), 10),
    leaseSeconds: Math.min(Math.max(asPositiveInt(event.lease_seconds ?? process.env.XMON_SIGNIFICANCE_LEASE_SECONDS, 300), 30), 3600),
    significanceVersion: asString(process.env.XMON_SIGNIFICANCE_VERSION) || "ai_v2",
    lambdaSafetyMarginMs: asPositiveInt(process.env.XMON_SIGNIFICANCE_LAMBDA_SAFETY_MARGIN_MS, DEFAULT_LAMBDA_SAFETY_MARGIN_MS),
  };
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
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
  } catch (error) {
    if (didTimeout || error?.name === "AbortError") {
      throw new Error(`request timed out after ${timeoutMs} ms`);
    }
    throw error;
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
    const reasoningContent = choice?.message?.reasoning_content;
    if (typeof reasoningContent === "string" && reasoningContent.trim()) {
      return reasoningContent.trim();
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
  const requestBody = {
    model: config.llmModel,
    messages: buildClassificationMessages(items),
    temperature: config.llmTemperature,
    max_tokens: config.llmMaxTokens,
    response_format: classificationResponseSchema(),
  };
  if (config.llmDisableThinking && isVeniceApiUrl(config.llmUrl)) {
    requestBody.venice_parameters = { disable_thinking: true };
  }

  const payload = await fetchJsonWithTimeout(
    `${config.llmUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.llmApiKey}`,
        "content-type": "application/json",
        "user-agent": "xmonitor-significance-classifier/1.0",
      },
      body: JSON.stringify(requestBody),
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

async function requestBatchClassificationWithRetry(config, items, batchIndex) {
  let lastError = null;
  for (let attempt = 1; attempt <= config.llmMaxAttempts; attempt += 1) {
    const attemptStartedAt = Date.now();
    try {
      return await requestBatchClassification(config, items);
    } catch (error) {
      lastError = error;
      logStructured("warn", "significance_llm_attempt_failed", {
        batch_index: batchIndex,
        attempt,
        max_attempts: config.llmMaxAttempts,
        duration_ms: elapsedMs(attemptStartedAt),
        error: errorMessage(error),
        status_ids: sampleStatusIds(items),
      });
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
  return {
    items: Array.isArray(response?.items) ? response.items : [],
    backlog: response?.backlog && typeof response.backlog === "object" ? response.backlog : null,
  };
}

async function applyResults(config, items) {
  return postJsonWithTimeout(
    `${config.ingestApiBaseUrl}/ingest/significance/batch`,
    config.ingestApiKey,
    { items },
    config.ingestTimeoutMs
  );
}

function retryableFailureItems(items, config, message) {
  return items.map((item) => ({
    status_id: item.status_id,
    classification_status: "failed",
    significance_version: config.significanceVersion,
    classification_model: config.llmModel,
    classification_error: message,
  }));
}

export async function handler(event = {}, context = {}) {
  const runStartedAt = Date.now();
  const config = getConfig(event);

  logStructured("info", "significance_run_start", {
    model: config.llmModel,
    batch_size: config.batchSize,
    max_posts_per_run: config.maxPostsPerRun,
    llm_timeout_ms: config.llmTimeoutMs,
    llm_max_attempts: config.llmMaxAttempts,
    lambda_safety_margin_ms: config.lambdaSafetyMarginMs,
    remaining_time_ms: finiteRemainingTimeMs(context),
  });

  if (!config.enabled) {
    return { ok: true, skipped: "disabled", ran_at: nowIso() };
  }
  if (!config.ingestApiKey) {
    throw new Error("missing significance ingest API key");
  }
  if (!config.llmApiKey) {
    throw new Error("missing significance LLM API key");
  }

  const claimStartedAt = Date.now();
  const claim = await claimPosts(config);
  const claimed = claim.items;
  logStructured("info", "significance_claim_complete", {
    claimed: claimed.length,
    duration_ms: elapsedMs(claimStartedAt),
    status_ids: sampleStatusIds(claimed),
    backlog: claim.backlog,
  });

  if (claimed.length === 0) {
    emitMetrics({
      ClaimedCount: 0,
      ClassifiedCount: 0,
      FailedCount: 0,
      HardRejectedCount: 0,
      AiBatchCount: 0,
      TimeBudgetExhaustedCount: 0,
      ApplyErrorCount: 0,
      RunDurationMs: elapsedMs(runStartedAt),
      ...backlogMetrics(claim.backlog),
    });
    return {
      ok: true,
      claimed: 0,
      classified: 0,
      failed: 0,
      hard_rejected: 0,
      ai_batches: 0,
      model: config.llmModel,
      backlog: claim.backlog,
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
  let timeBudgetExhausted = false;

  const batches = chunkArray(aiCandidates, config.batchSize);
  for (let batchOffset = 0; batchOffset < batches.length; batchOffset += 1) {
    const batch = batches[batchOffset];
    const batchIndex = batchOffset + 1;
    if (!hasTimeForLlmBatch(config, context)) {
      timeBudgetExhausted = true;
      const remainingItems = batches.slice(batchOffset).flat();
      const message = `classifier_time_budget_exhausted: ${Math.round(remainingTimeMs(context))} ms remaining before batch ${batchIndex}`;
      failed += remainingItems.length;
      resultItems.push(...retryableFailureItems(remainingItems, config, message));
      logStructured("warn", "significance_time_budget_exhausted", {
        batch_index: batchIndex,
        remaining_batches: batches.length - batchOffset,
        failed_retryable: remainingItems.length,
        remaining_time_ms: finiteRemainingTimeMs(context),
        required_time_ms: config.llmTimeoutMs + config.ingestTimeoutMs + config.lambdaSafetyMarginMs,
        status_ids: sampleStatusIds(remainingItems),
      });
      break;
    }

    const batchStartedAt = Date.now();
    logStructured("info", "significance_batch_start", {
      batch_index: batchIndex,
      batch_count: batches.length,
      batch_size: batch.length,
      remaining_time_ms: finiteRemainingTimeMs(context),
      status_ids: sampleStatusIds(batch),
    });
    try {
      const batchResults = await requestBatchClassificationWithRetry(config, batch, batchIndex);
      resultItems.push(...batchResults);
      aiBatches += 1;
      logStructured("info", "significance_batch_complete", {
        batch_index: batchIndex,
        duration_ms: elapsedMs(batchStartedAt),
        classified: batchResults.length,
        status_ids: sampleStatusIds(batch),
      });
    } catch (error) {
      failed += batch.length;
      const message = errorMessage(error) || "significance_classifier_failed";
      resultItems.push(...retryableFailureItems(batch, config, message));
      logStructured("error", "significance_batch_failed", {
        batch_index: batchIndex,
        duration_ms: elapsedMs(batchStartedAt),
        failed: batch.length,
        error: message,
        status_ids: sampleStatusIds(batch),
      });
    }
  }

  const applyStartedAt = Date.now();
  logStructured("info", "significance_apply_start", {
    result_items: resultItems.length,
    classified: resultItems.filter((item) => item.classification_status === "classified").length,
    failed,
    hard_rejected: hardRejected.length,
    remaining_time_ms: finiteRemainingTimeMs(context),
  });
  const ingestResult = await applyResults(config, resultItems);
  const applyErrors = Array.isArray(ingestResult?.errors) ? ingestResult.errors : [];

  logStructured("info", "significance_apply_complete", {
    duration_ms: elapsedMs(applyStartedAt),
    updated: Number(ingestResult?.updated || 0),
    skipped: Number(ingestResult?.skipped || 0),
    errors: applyErrors.length,
  });

  emitMetrics({
    ClaimedCount: claimed.length,
    ClassifiedCount: resultItems.filter((item) => item.classification_status === "classified").length,
    FailedCount: failed,
    HardRejectedCount: hardRejected.length,
    AiBatchCount: aiBatches,
    TimeBudgetExhaustedCount: timeBudgetExhausted ? 1 : 0,
    ApplyErrorCount: applyErrors.length,
    RunDurationMs: elapsedMs(runStartedAt),
    ...backlogMetrics(claim.backlog),
  });

  logStructured("info", "significance_run_complete", {
    claimed: claimed.length,
    classified: resultItems.filter((item) => item.classification_status === "classified").length,
    failed,
    hard_rejected: hardRejected.length,
    ai_batches: aiBatches,
    time_budget_exhausted: timeBudgetExhausted,
    duration_ms: elapsedMs(runStartedAt),
  });

  return {
    ok: true,
    claimed: claimed.length,
    classified: resultItems.filter((item) => item.classification_status === "classified").length,
    failed,
    hard_rejected: hardRejected.length,
    ai_batches: aiBatches,
    time_budget_exhausted: timeBudgetExhausted,
    model: config.llmModel,
    backlog: claim.backlog,
    ingest: {
      updated: Number(ingestResult?.updated || 0),
      skipped: Number(ingestResult?.skipped || 0),
      errors: applyErrors,
    },
    ran_at: nowIso(),
  };
}
