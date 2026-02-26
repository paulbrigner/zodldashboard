#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    input: "scripts/eval/compose_eval_prompts.json",
    baseUrl: process.env.COMPOSE_EVAL_BASE_URL || "http://localhost:3000/api/v1",
    output: "",
    delayMs: Number.parseInt(process.env.COMPOSE_EVAL_DELAY_MS || "200", 10),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--input" && next) {
      args.input = next;
      i += 1;
    } else if (token === "--base-url" && next) {
      args.baseUrl = next;
      i += 1;
    } else if (token === "--output" && next) {
      args.output = next;
      i += 1;
    } else if (token === "--delay-ms" && next) {
      const parsed = Number.parseInt(next, 10);
      args.delayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : args.delayMs;
      i += 1;
    }
  }

  return args;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function toFixedNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

async function sleep(ms) {
  if (!ms || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readPromptFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("prompt file must be a JSON array");
  }
  return parsed;
}

async function readErrorText(response) {
  try {
    const payload = await response.json();
    if (payload && typeof payload.error === "string" && payload.error.trim()) return payload.error;
  } catch {
    // fall through
  }

  try {
    const text = await response.text();
    const snippet = text.trim().split("\n")[0] || "";
    return snippet || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const prompts = await readPromptFile(args.input);
  if (prompts.length === 0) {
    throw new Error("prompt file is empty");
  }

  const startedAt = new Date().toISOString();
  const base = args.baseUrl.replace(/\/+$/, "");
  const endpoint = `${base}/query/compose`;

  const outputPath =
    args.output ||
    path.join("data", "eval", `compose_eval_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const results = [];
  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index] || {};
    const promptId = typeof prompt.id === "string" && prompt.id.trim() ? prompt.id.trim() : `prompt_${index + 1}`;
    const taskText = typeof prompt.task_text === "string" ? prompt.task_text.trim() : "";
    if (!taskText) {
      results.push({
        id: promptId,
        ok: false,
        status: 0,
        latency_ms: null,
        error: "task_text missing",
      });
      continue;
    }

    const body = {
      task_text: taskText,
      answer_style: prompt.answer_style || "balanced",
      draft_format: prompt.draft_format || "none",
      since: prompt.since,
      until: prompt.until,
      tier: prompt.tier,
      handle: prompt.handle,
      significant: prompt.significant,
      retrieval_limit: prompt.retrieval_limit,
      context_limit: prompt.context_limit,
    };

    const requestStart = Date.now();
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      results.push({
        id: promptId,
        ok: false,
        status: 0,
        latency_ms: Date.now() - requestStart,
        error: error instanceof Error ? error.message : "network error",
      });
      await sleep(args.delayMs);
      continue;
    }

    const latencyMs = Date.now() - requestStart;
    if (!response.ok) {
      results.push({
        id: promptId,
        ok: false,
        status: response.status,
        latency_ms: latencyMs,
        error: await readErrorText(response),
      });
      await sleep(args.delayMs);
      continue;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const citations = Array.isArray(payload?.citations) ? payload.citations.length : 0;
    const keyPoints = Array.isArray(payload?.key_points) ? payload.key_points.length : 0;
    const answerText = typeof payload?.answer_text === "string" ? payload.answer_text : "";
    const draftText = typeof payload?.draft_text === "string" ? payload.draft_text : "";
    const retrievalStats = payload?.retrieval_stats || {};

    results.push({
      id: promptId,
      ok: true,
      status: response.status,
      latency_ms: latencyMs,
      answer_chars: answerText.length,
      draft_chars: draftText.length,
      key_points: keyPoints,
      citations,
      retrieved_count: Number.isFinite(Number(retrievalStats.retrieved_count)) ? Number(retrievalStats.retrieved_count) : null,
      used_count: Number.isFinite(Number(retrievalStats.used_count)) ? Number(retrievalStats.used_count) : null,
      retrieval_latency_ms: Number.isFinite(Number(retrievalStats.latency_ms)) ? Number(retrievalStats.latency_ms) : null,
    });

    await sleep(args.delayMs);
  }

  const successes = results.filter((row) => row.ok);
  const latencies = successes.map((row) => row.latency_ms).filter((value) => Number.isFinite(value));
  const citationCounts = successes.map((row) => row.citations).filter((value) => Number.isFinite(value));
  const answerLens = successes.map((row) => row.answer_chars).filter((value) => Number.isFinite(value));

  const report = {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    endpoint,
    prompts_total: prompts.length,
    ok_count: successes.length,
    fail_count: prompts.length - successes.length,
    latency_ms: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      avg: latencies.length ? toFixedNumber(latencies.reduce((sum, value) => sum + value, 0) / latencies.length, 2) : null,
    },
    answer_chars: {
      avg: answerLens.length ? toFixedNumber(answerLens.reduce((sum, value) => sum + value, 0) / answerLens.length, 2) : null,
    },
    citations: {
      avg: citationCounts.length
        ? toFixedNumber(citationCounts.reduce((sum, value) => sum + value, 0) / citationCounts.length, 2)
        : null,
      zero_citation_answers: successes.filter((row) => (row.citations || 0) === 0).length,
    },
    results,
  };

  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`compose eval complete`);
  console.log(`endpoint: ${endpoint}`);
  console.log(`output: ${outputPath}`);
  console.log(`ok=${report.ok_count} fail=${report.fail_count}`);
  console.log(`latency p50=${report.latency_ms.p50}ms p95=${report.latency_ms.p95}ms avg=${report.latency_ms.avg}ms`);
  console.log(`avg citations=${report.citations.avg} zero-citation=${report.citations.zero_citation_answers}`);
}

run().catch((error) => {
  console.error(`compose eval failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
