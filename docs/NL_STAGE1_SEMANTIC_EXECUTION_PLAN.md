# Stage 1 Execution Plan - Semantic Retrieval (No Compose)

_Drafted: 2026-02-26 (ET)_

## 1) Objective

Implement Stage 1 natural-language search for X Monitor:
- retrieve relevant posts by embedding similarity,
- return ranked results with score,
- keep existing filters (time window, tier, handle, significant),
- do not generate AI narrative/draft output yet.

This stage establishes reliable semantic retrieval as the foundation for later grounded composition (Stage 2).

## 2) Scope

In scope:
- `pgvector` enablement and vector index.
- semantic query API endpoint.
- embeddings ingest endpoint for ongoing freshness.
- dashboard semantic search mode and result scoring.
- operational guardrails, validation set, rollout gates.

Out of scope:
- `POST /v1/query/compose` or any drafting endpoint.
- long-form AI-generated summaries/posts.
- automated posting workflows.

## 3) Preconditions

Must be true before Stage 1 starts:
- direct ingest guardrails are active and healthy.
- Postgres is primary source of truth for dashboard reads/writes.
- existing embedding corpus exists in `embeddings.vector_json`.
- Venice embedding credentials are available server-side.

## 4) Locked technical contract

Embedding provider/model:
- provider: Venice
- model: `text-embedding-bge-m3`
- query-time model must match stored post embedding model family.

Initial semantic endpoint:
- `POST /v1/query/semantic`
- request:
  - `query_text` (required),
  - optional filters: `since`, `until`, `tier`, `handle`, `significant`,
  - optional `limit`.
- response:
  - feed-like `items[]` + `score`,
  - metadata: `model`, `retrieved_count`.

## 5) Workstreams and checklist

### WS1 - Contract and value gate

- [ ] Finalize 20-30 real analyst prompts (including protocol/governance and digital cash framing prompts).
- [ ] Run baseline lexical retrieval (`q`) on prompt set.
- [ ] Run semantic retrieval prototype on same set.
- [ ] Human-judge top-k relevance and log results.
- [ ] Go/no-go gate: semantic must materially improve precision@k and query success rate.

Deliverables:
- prompt set file under `docs/` or `reports/`.
- short evaluation report with pass/fail recommendation.

### WS2 - Database enablement (`pgvector`)

- [ ] Add migration `db/migrations/003_pgvector_semantic.sql`:
  - `CREATE EXTENSION IF NOT EXISTS vector;`
  - add `embeddings.embedding vector(<dims>)`.
- [ ] Backfill `embedding` from `vector_json`.
- [ ] Add ANN index (HNSW, cosine metric).
- [ ] Add integrity checks for dimension mismatch logging.

Deliverables:
- migration SQL committed.
- documented backfill command and runtime notes.

### WS3 - API + Lambda implementation

- [ ] Add request/response schemas to `docs/openapi.v1.yaml`.
- [ ] Implement `POST /v1/query/semantic` in `services/vpc-api-lambda/index.mjs`.
- [ ] Implement semantic query validator in `lib/xmonitor/validators.ts` (if shared).
- [ ] Add `POST /v1/ingest/embeddings/batch` endpoint.
- [ ] Ensure embeddings upsert writes both `vector_json` and `embedding`.
- [ ] Add bounded defaults and caps (`default limit`, `max limit`, score threshold).

Deliverables:
- endpoint live in Lambda.
- OpenAPI updated.

### WS4 - Embedding freshness path

- [ ] Confirm generation owner (recommended: collector/OpenClaw side).
- [ ] Ensure new or changed posts get embedding upserts.
- [ ] Add text-hash idempotency (skip unchanged body text).
- [ ] Add retry/dead-letter logging for embedding failures.

Deliverables:
- deterministic embedding freshness for new content.

### WS5 - Dashboard UX (semantic mode only)

- [ ] Add search mode selector on `/x-monitor`:
  - `Keyword` (existing),
  - `Semantic` (new).
- [ ] Route semantic searches to API semantic endpoint.
- [ ] Keep existing filter controls reusable for semantic calls.
- [ ] Display score/relevance badge for semantic results.
- [ ] Keep post detail flow unchanged.

Deliverables:
- internal users can run semantic query from X Monitor.

### WS6 - Operations and observability

- [ ] Add structured logs for semantic query requests:
  - model, latency, retrieved_count, top score.
- [ ] Add error taxonomy in logs:
  - provider timeout, dims mismatch, SQL/index errors.
- [ ] Define kill switch env:
  - `XMONITOR_SEMANTIC_ENABLED=false` fallback to lexical.
- [ ] Add basic smoke checks to runbook.

Deliverables:
- rollback/fallback path documented and testable.

## 6) File touchpoints (expected)

- `db/migrations/003_pgvector_semantic.sql` (new)
- `services/vpc-api-lambda/index.mjs`
- `lib/xmonitor/validators.ts`
- `lib/xmonitor/types.ts`
- `docs/openapi.v1.yaml`
- `docs/POSTGRES_SCHEMA_AND_OPENAPI_V1.md`
- `app/x-monitor/page.tsx`
- optional helpers under `app/x-monitor/`

## 7) Environment and secrets

Required:
- `XMONITOR_EMBEDDING_PROVIDER=venice`
- `XMONITOR_EMBEDDING_BASE_URL=<venice embeddings base url>`
- `XMONITOR_EMBEDDING_MODEL=text-embedding-bge-m3`
- `XMONITOR_EMBEDDING_DIMS=<confirmed dims>`
- `XMONITOR_EMBEDDING_API_KEY=<server-side secret>`
- `XMONITOR_SEMANTIC_DEFAULT_LIMIT`
- `XMONITOR_SEMANTIC_MAX_LIMIT`
- `XMONITOR_SEMANTIC_MIN_SCORE`
- `XMONITOR_SEMANTIC_ENABLED=true`

Security:
- keys remain server-side only (Lambda/Amplify env + Secrets Manager).
- browser never calls provider directly.

## 8) Validation and acceptance gates

Gate A - Functional:
- `POST /v1/query/semantic` returns ranked results with scores.
- filters constrain semantic results correctly.

Gate B - Quality:
- semantic relevance beats lexical baseline on agreed prompt set.

Gate C - Performance:
- p95 latency stays within acceptable budget for interactive UI.

Gate D - Safety:
- no provider key exposure in client payloads/logs.
- kill switch tested (`semantic -> lexical fallback`).

## 9) Rollout sequence

1. Deploy DB migration and backfill in staging-like environment.
2. Deploy Lambda/API contract.
3. Enable semantic UI for internal testing only.
4. Run prompt-set evaluation and sign off quality gates.
5. Gradually enable for broader users.

Rollback:
- disable semantic via env switch.
- keep keyword mode fully available.

## 10) Estimated implementation effort

Assuming no blocking infrastructure surprises:
- WS1 (value gate): 0.5-1 day
- WS2 (DB + backfill): 1 day
- WS3 (API + docs): 1-1.5 days
- WS4 (freshness path): 1 day
- WS5 (UI): 0.5-1 day
- WS6 (ops + hardening): 0.5 day

Total: ~4.5 to 6 days elapsed, plus review/deploy windows.

## 11) Inputs needed from you before execution

- Venice API key for server-side embedding calls.
- Confirmation of preferred latency target for semantic queries.
- Approval of baseline prompt set used for relevance gate.
- Approval that Stage 1 excludes AI drafting/composition.
