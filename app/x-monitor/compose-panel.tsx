"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { ComposeAnswerStyle, ComposeDraftFormat, ComposeQueryResponse } from "@/lib/xmonitor/types";

type ComposePanelProps = {
  enabled: boolean;
  unavailableReason?: string | null;
  initialSince?: string;
  initialUntil?: string;
  initialTier?: string;
  initialHandle?: string;
  initialSignificant?: boolean;
};

const DEFAULT_TASK_TEXT =
  "Review the top X posts over the last 24 hours on protocol adjustments and draft an X post response that prioritizes digital cash user outcomes.";

function asPositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function summarizeScope(props: ComposePanelProps): string {
  const parts: string[] = [];
  if (props.initialSince) parts.push(`since ${new Date(props.initialSince).toLocaleString()}`);
  if (props.initialUntil) parts.push(`until ${new Date(props.initialUntil).toLocaleString()}`);
  if (props.initialTier) parts.push(`tier ${props.initialTier}`);
  if (props.initialHandle) parts.push(`handle ${props.initialHandle}`);
  if (props.initialSignificant !== undefined) parts.push(`significant=${String(props.initialSignificant)}`);
  if (parts.length === 0) return "Scope: all posts in current corpus.";
  return `Scope: ${parts.join(" | ")}`;
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // fall through
  }
  return `Request failed (${response.status})`;
}

function isComposeQueryResponse(value: unknown): value is ComposeQueryResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.answer_text !== "string") return false;
  if (!Array.isArray(record.key_points) || !Array.isArray(record.citations)) return false;
  const stats = record.retrieval_stats;
  if (!stats || typeof stats !== "object") return false;
  const statsRecord = stats as Record<string, unknown>;
  return (
    Number.isFinite(Number(statsRecord.retrieved_count)) &&
    Number.isFinite(Number(statsRecord.used_count)) &&
    typeof statsRecord.model === "string" &&
    Number.isFinite(Number(statsRecord.latency_ms))
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ComposePanel(props: ComposePanelProps) {
  const [taskText, setTaskText] = useState("");
  const [answerStyle, setAnswerStyle] = useState<ComposeAnswerStyle>("balanced");
  const [draftFormat, setDraftFormat] = useState<ComposeDraftFormat>("none");
  const [retrievalLimit, setRetrievalLimit] = useState("30");
  const [contextLimit, setContextLimit] = useState("8");
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [result, setResult] = useState<ComposeQueryResponse | null>(null);
  const [copyState, setCopyState] = useState<"answer" | "draft" | null>(null);

  const scopeSummary = useMemo(() => summarizeScope(props), [props]);

  async function handleCopy(kind: "answer" | "draft", text: string) {
    const ok = await copyToClipboard(text);
    if (!ok) {
      setErrorText("Copy failed in this browser context.");
      return;
    }
    setCopyState(kind);
    setTimeout(() => setCopyState((current) => (current === kind ? null : current)), 1500);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorText(null);

    if (!props.enabled) {
      setErrorText(props.unavailableReason || "Compose mode is unavailable.");
      return;
    }

    const task = taskText.trim();
    if (!task) {
      setErrorText("Task text is required.");
      return;
    }

    const retrieval = asPositiveInt(retrievalLimit);
    const context = asPositiveInt(contextLimit);

    const payload = {
      task_text: task,
      answer_style: answerStyle,
      draft_format: draftFormat,
      retrieval_limit: retrieval,
      context_limit: context,
      since: props.initialSince,
      until: props.initialUntil,
      tier: props.initialTier,
      handle: props.initialHandle,
      significant: props.initialSignificant,
    };

    setIsLoading(true);
    try {
      const response = await fetch("/api/v1/query/compose", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const body = await response.json();
      if (!isComposeQueryResponse(body)) {
        throw new Error("Invalid compose response payload");
      }

      setResult(body);
    } catch (error) {
      setResult(null);
      setErrorText(error instanceof Error ? error.message : "Compose request failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <details className="compose-panel" open>
      <summary className="compose-panel-summary">
        <span className="compose-panel-title-wrap">
          <span className="compose-panel-title">Answer Mode</span>
          <span aria-hidden className="disclosure-caret">
            ▾
          </span>
        </span>
        <span className="summary-panel-state">{result ? `${result.citations.length} citations` : "grounded RAG"}</span>
      </summary>

      <div className="compose-panel-body">
        {!props.enabled ? <p className="error-text">{props.unavailableReason || "Compose mode is unavailable."}</p> : null}

        <form className="compose-form" onSubmit={handleSubmit}>
          <label className="compose-task-field">
            <span>Task</span>
            <textarea
              onChange={(event) => setTaskText(event.target.value)}
              placeholder="Describe what you want answered and optionally drafted."
              rows={5}
              value={taskText}
            />
          </label>

          <div className="compose-controls">
            <label>
              <span>Answer style</span>
              <select onChange={(event) => setAnswerStyle(event.target.value as ComposeAnswerStyle)} value={answerStyle}>
                <option value="brief">Brief</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>

            <label>
              <span>Draft format</span>
              <select onChange={(event) => setDraftFormat(event.target.value as ComposeDraftFormat)} value={draftFormat}>
                <option value="none">None</option>
                <option value="x_post">X post</option>
                <option value="thread">Thread</option>
              </select>
            </label>

            <label>
              <span>Retrieval limit</span>
              <input
                min={1}
                onChange={(event) => setRetrievalLimit(event.target.value)}
                step={1}
                type="number"
                value={retrievalLimit}
              />
            </label>

            <label>
              <span>Context limit</span>
              <input
                min={1}
                onChange={(event) => setContextLimit(event.target.value)}
                step={1}
                type="number"
                value={contextLimit}
              />
            </label>
          </div>

          <p className="subtle-text compose-scope">{scopeSummary}</p>

          <div className="compose-actions">
            <button className="button" disabled={isLoading || !props.enabled} type="submit">
              {isLoading ? "Generating..." : "Generate answer"}
            </button>
            <button
              className="button button-secondary"
              disabled={isLoading}
              onClick={() => {
                setTaskText("");
                setResult(null);
                setErrorText(null);
              }}
              type="button"
            >
              Clear
            </button>
            <button className="button button-secondary" disabled={isLoading} onClick={() => setTaskText(DEFAULT_TASK_TEXT)} type="button">
              Use example
            </button>
          </div>
        </form>

        {errorText ? <p className="error-text">{errorText}</p> : null}

        {result ? (
          <div className="compose-result">
            <div className="compose-result-meta">
              <p className="subtle-text">
                Retrieved {result.retrieval_stats.retrieved_count} candidates, used {result.retrieval_stats.used_count} evidence posts.
              </p>
              <p className="subtle-text">
                Retrieval model {result.retrieval_stats.model}, latency {result.retrieval_stats.latency_ms} ms.
              </p>
            </div>

            <section className="compose-section">
              <div className="compose-section-header">
                <h3>Answer</h3>
                <button className="button button-secondary button-small" onClick={() => handleCopy("answer", result.answer_text)} type="button">
                  {copyState === "answer" ? "Copied" : "Copy answer"}
                </button>
              </div>
              <p className="compose-answer-text">{result.answer_text}</p>
            </section>

            {result.draft_text ? (
              <section className="compose-section">
                <div className="compose-section-header">
                  <h3>Draft</h3>
                  <button
                    className="button button-secondary button-small"
                    onClick={() => handleCopy("draft", result.draft_text || "")}
                    type="button"
                  >
                    {copyState === "draft" ? "Copied" : "Copy draft"}
                  </button>
                </div>
                <p className="compose-answer-text">{result.draft_text}</p>
              </section>
            ) : null}

            {result.key_points.length > 0 ? (
              <section className="compose-section">
                <h3>Key points</h3>
                <ul className="compose-key-points">
                  {result.key_points.map((point, index) => (
                    <li key={`${index}-${point}`}>{point}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="compose-section">
              <h3>Citations</h3>
              <ul className="compose-citations">
                {result.citations.map((citation) => (
                  <li className="compose-citation-item" key={citation.status_id}>
                    <p className="compose-citation-top">
                      <strong>@{citation.author_handle}</strong>
                      <span className="subtle-text">status {citation.status_id}</span>
                    </p>
                    <p className="compose-citation-excerpt">{citation.excerpt}</p>
                    <a className="button button-secondary button-small" href={citation.url} rel="noreferrer" target="_blank">
                      Open source post
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </div>
    </details>
  );
}
