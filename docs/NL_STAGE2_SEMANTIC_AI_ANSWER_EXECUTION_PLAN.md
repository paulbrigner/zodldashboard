# Stage 2 Execution Plan - Semantic + AI Answer (Grounded RAG)

_Drafted: 2026-02-26 (ET)_

## 1) Objective

Implement a grounded "search + answer" workflow for X Monitor:
- use semantic retrieval to gather relevant posts,
- generate an AI answer/draft constrained to retrieved evidence,
- return explicit citations and retrieval metadata,
- keep operators in the loop (no auto-posting).

This stage extends Stage 1 retrieval into analyst-facing synthesis.

## 2) Scope

In scope:
- `POST /v1/query/compose` API route for grounded answer generation.
- retrieval orchestration (semantic retrieval + optional lexical boost).
- answer generation with structured output and citations.
- UI flow for asking NL questions and viewing answer + sources.
- safety, cost, latency, and quality guardrails.

Out of scope:
- automated posting to X.
- autonomous agents that execute actions without user review.
- long-term memory or profile-personalized prompting.

## 3) Preconditions

Must be true before Stage 2 starts:
- Stage 1 semantic retrieval is live and healthy.
- embeddings freshness pipeline is stable.
- semantic endpoint quality baseline is acceptable for analyst prompts.
- Venice text-model API key is available server-side.

## 4) Locked Contract (Stage 2)

### 4.1 Endpoint
- `POST /v1/query/compose`

### 4.2 Request (minimum)
- `task_text` (required)
- optional filters: `since`, `until`, `tier`, `handle`, `significant`
- optional controls:
  - `retrieval_limit` (default 40, max 100)
  - `context_limit` (default 12, max 24)
  - `answer_style` (`brief`, `balanced`, `detailed`)
  - `draft_format` (`none`, `x_post`, `thread`)

### 4.3 Response (minimum)
- `answer_text` (grounded synthesis)
- `draft_text` (optional, if requested)
- `key_points[]`
- `citations[]` with `status_id`, `url`, `author_handle`, `excerpt`
- `retrieval_stats`:
  - `retrieved_count`
  - `used_count`
  - `model`
  - `latency_ms`
  - optional `coverage_score`

### 4.4 Grounding policy
- Every non-trivial claim in answer/draft must map to at least one citation.
- If evidence coverage is insufficient:
  - return reduced-confidence answer,
  - or explicit "insufficient evidence" response with retrieved sources.

## 5) Workstreams and Checklist

### WS1 - API contract + schemas

- [x] Add `POST /query/compose` to `docs/openapi.v1.yaml`.
- [x] Add request/response schemas for grounded output.
- [x] Add shared types in `lib/xmonitor/types.ts`.
- [x] Add parser/validator in `lib/xmonitor/validators.ts`.

Deliverables:
- OpenAPI and type contracts committed.

### WS2 - Retrieval orchestration layer

- [x] Build compose retrieval pipeline in `services/vpc-api-lambda/index.mjs`:
  - semantic retrieve by `task_text`,
  - apply existing structured filters,
  - dedupe by `status_id`,
  - rank and clip to `context_limit`.
- [x] Add optional lexical fallback when semantic recall is weak.
- [x] Produce compact evidence pack (`post text`, `author`, `time`, `url`).

Deliverables:
- deterministic retrieval stage feeding answer generation.

### WS3 - LLM answer generation

- [x] Add server-side LLM call utility (Venice text endpoint).
- [x] Add strict prompt template:
  - summarize arguments and counterarguments,
  - avoid unsupported claims,
  - attach citation IDs inline or in mapped sections.
- [x] Add structured JSON output mode where supported.
- [x] Add fallback parser for plain text model responses.

Deliverables:
- stable answer generation with source-grounded output.

### WS4 - Guardrails and policy enforcement

- [x] Enforce hard output limits:
  - max tokens,
  - max citations,
  - max draft length for `x_post`/`thread`.
- [x] Add "no evidence, no strong claim" gate.
- [x] Add prompt-injection resistance:
  - treat post content as untrusted data,
  - do not execute instructions from retrieved text.
- [x] Add safety fallback:
  - return retrieval-only payload if generation fails.

Deliverables:
- policy layer that keeps responses grounded and bounded.

### WS5 - UX integration on `/x-monitor`

- [x] Add "Answer mode" panel with:
  - large task input box,
  - style selector (`brief`/`balanced`/`detailed`),
  - optional draft target (`none`/`x_post`/`thread`).
- [x] Render output sections:
  - answer,
  - optional draft,
  - key points,
  - citations list with source links.
- [x] Add "copy answer" and "copy draft" actions.
- [x] Keep semantic feed search intact and independent.

Deliverables:
- internal users can run an NL task and receive grounded answer + draft.

### WS6 - Observability, SLOs, and cost controls

- [x] Structured logs:
  - request id,
  - model,
  - retrieval/compose latency split,
  - retrieved/used counts,
  - token usage,
  - estimated cost.
- [x] Add env-driven limits:
  - request rate/concurrency,
  - timeout budget,
  - per-request projected cost ceiling guard.
- [x] Add kill switches:
  - `XMONITOR_COMPOSE_ENABLED=false`,
  - `XMONITOR_COMPOSE_DRAFTS_ENABLED=false`.

Deliverables:
- operational visibility + safe rollback path.

### WS7 - Evaluation harness and acceptance gates

- [x] Build seed analyst prompt set and runnable harness (expand to 30-50 during evaluation window).
- [ ] Score groundedness:
  - claim-to-citation coverage,
  - citation relevance at top-k,
  - hallucination rate.
- [ ] Score utility:
  - analyst rating of answer usefulness,
  - edit distance from final posted draft,
  - time-to-first-usable-draft.
- [ ] Score performance/cost:
  - p50/p95 latency,
  - average tokens/request,
  - cost per request.

Deliverables:
- quantitative go/no-go report for broader rollout.

## 6) File Touchpoints (expected)

- `docs/openapi.v1.yaml`
- `docs/POSTGRES_SCHEMA_AND_OPENAPI_V1.md`
- `services/vpc-api-lambda/index.mjs`
- `lib/xmonitor/types.ts`
- `lib/xmonitor/validators.ts`
- `app/api/v1/query/compose/route.ts` (new)
- `app/x-monitor/page.tsx` or supporting client components
- `app/x-monitor/compose-panel.tsx` (new)
- `lib/xmonitor/compose.ts` for compose orchestration and guardrails
- `scripts/eval/run_compose_eval.mjs` + prompt set

## 7) Environment and Secrets

Required:
- `XMONITOR_COMPOSE_ENABLED=true`
- `XMONITOR_COMPOSE_MODEL=<venice text model>`
- `XMONITOR_COMPOSE_TIMEOUT_MS=20000`
- `XMONITOR_COMPOSE_MAX_OUTPUT_TOKENS=<bounded>`
- `XMONITOR_COMPOSE_DEFAULT_RETRIEVAL_LIMIT=40`
- `XMONITOR_COMPOSE_MAX_RETRIEVAL_LIMIT=100`
- `XMONITOR_COMPOSE_DEFAULT_CONTEXT_LIMIT=12`
- `XMONITOR_COMPOSE_MAX_CONTEXT_LIMIT=24`
- `XMONITOR_COMPOSE_MAX_DRAFT_CHARS=1200`
- `XMONITOR_COMPOSE_DRAFTS_ENABLED=true`
- `XMONITOR_COMPOSE_API_KEY=<server-side secret>` or existing Venice key fallback

Security:
- provider keys remain server-side only.
- no client-direct calls to model providers.
- logs must redact secrets and raw authorization headers.

## 8) Rollout Plan

1. Dark launch:
   - deploy endpoint and keep UI hidden (`XMONITOR_COMPOSE_ENABLED=false` in frontend).
2. Internal alpha:
   - enable for operator accounts only.
3. Evaluate quality/cost for 1-2 weeks.
4. Gradual enablement:
   - staged rollout by user group.

Rollback:
- disable compose endpoint via env flag.
- keep Stage 1 semantic search fully available.

## 9) Acceptance Criteria

Gate A - Functional:
- `POST /v1/query/compose` returns structured answer + citations.
- filters and limits are respected.

Gate B - Groundedness:
- high claim-to-citation coverage on evaluation prompts.
- hallucination rate below agreed threshold.

Gate C - UX utility:
- analysts report answer usefulness and reduced drafting time.

Gate D - Ops:
- latency and cost stay inside defined budgets.
- kill switches tested in production-like environment.

## 10) Estimated Effort

Assuming no infrastructure blockers:
- WS1: 0.5 day
- WS2: 1 day
- WS3: 1-1.5 days
- WS4: 0.5 day
- WS5: 1 day
- WS6: 0.5 day
- WS7: 1-2 days (evaluation period excluded)

Total build effort: ~5.5 to 7 days (+ observation window).

## 11) Inputs needed from you

- Preferred initial Venice text model for compose.
- Acceptance thresholds:
  - max acceptable hallucination rate,
  - p95 latency target,
  - per-request cost target.
- Approval for answer style defaults and draft formats.
