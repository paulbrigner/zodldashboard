# OpenClaw NL Query Parity on AWS — Implementation Plan

_Drafted: 2026-02-23 (ET)_
_Updated: 2026-02-25 (ET)_

## 1) Goal

Restore the original OpenClaw natural-language (NL) query behavior on the AWS-backed system, so users can type plain-language prompts and retrieve relevant X posts via embedding similarity (not just keyword matching).

## 1.1) Decisions captured (2026-02-25)
- Stored post embeddings are already generated using `Venice.AI text-embedding-bge-m3`.
- Query-time embeddings for semantic search must use the same model family (`text-embedding-bge-m3`) to preserve vector-space compatibility.
- Venice API credentials will be supplied when implementation begins; all embedding calls remain server-side.
- Direct ingest-to-API cutover (removing SQLite+sync as a correctness dependency) is the preferred prerequisite before semantic rollout.

---

## 2) Current state vs required parity

## Current state (implemented)
- AWS Postgres schema includes `embeddings` table with `vector_json` payloads.
- Migration tooling imports historical embeddings into Postgres.
- API supports feed/detail + ingest for posts/metrics/reports/runs.
- Feed search `q` is lexical (`ILIKE`) against body text/handle.
- Existing embedding corpus was produced with `Venice.AI text-embedding-bge-m3`.

## Missing for NL parity
- No semantic retrieval endpoint in API.
- No embeddings ingest endpoint in live API routes.
- No `pgvector` extension or ANN index in current DB schema.
- No NL query UI flow in dashboard.
- No server-side embedding generation path for user NL prompts.

---

## 3) Target behavior (parity definition)

When a user enters a natural-language query (example: "show high-signal posts about shielded adoption concerns"), the system should:

1. Convert query text into an embedding.
2. Retrieve nearest posts by vector similarity.
3. Apply existing filters (tier, handle, date range, significant, limit) as optional constraints.
4. Return ranked results with a relevance score (or distance).
5. Allow opening post detail like the existing feed flow.

---

## 4) Recommended architecture

## 4.1 Data model
- Keep `embeddings.vector_json` for migration compatibility.
- Add a `vector` column using `pgvector` for fast similarity search.
- Keep `model` and `dims` columns authoritative for compatibility checks.

Recommended schema additions:
- `CREATE EXTENSION IF NOT EXISTS vector;`
- `ALTER TABLE embeddings ADD COLUMN embedding vector(<dims>);`
- Backfill `embedding` from `vector_json`.
- Add ANN index (HNSW recommended for retrieval latency).

## 4.2 Query execution model
- Compute query embedding server-side in Lambda (API key stays server-side).
- Execute SQL similarity search against `embeddings.embedding`.
- Join `posts` and `reports` to preserve current response shape and filtering.

## 4.3 API model
- Add `POST /v1/query/semantic` for NL search.
- Add `POST /v1/ingest/embeddings/batch` for ongoing embedding upserts.
- Keep current `GET /v1/feed` unchanged for lexical/filter-only use.

---

## 5) Implementation steps

## Phase 0: Lock parity contract

1. Lock embedding provider/model contract:
   - provider: Venice API
   - model: `text-embedding-bge-m3`
2. Confirm expected dimensions (`dims`) from current rows and normalization behavior.
3. Define semantic ranking semantics:
   - similarity metric (cosine or inner product),
   - default `top_k`,
   - minimum relevance threshold,
   - interaction with existing filters.
4. Define response contract (include `score` field).

Deliverable:
- One signed-off parity contract section added to this document before coding.

## Phase 0.5: Value gate (recommended before coding)

1. Build a prompt set of 20-30 real analyst-style NL queries.
2. Run baseline lexical (`q`) retrieval vs semantic retrieval on the same prompts.
3. Human-label top-k relevance for both modes.
4. Compare:
   - precision@k,
   - query success rate (at least one useful hit),
   - time-to-first-useful-post.
5. Proceed to implementation only if semantic shows clear uplift for real workflows.

Deliverable:
- Evidence-based go/no-go decision before full buildout.

## Phase 1: Database enablement (`pgvector`)

1. Create new migration (example: `db/migrations/002_pgvector_semantic.sql`):
   - enable `vector` extension,
   - add `embeddings.embedding` vector column,
   - add check/guard for dimension consistency.
2. Backfill script:
   - read `vector_json`,
   - cast/write into `embedding`,
   - log invalid row counts.
3. Indexing:
   - create HNSW index on `embedding` using cosine (or chosen metric),
   - keep `idx_embeddings_model` for model filtering.

Deliverables:
- Migration SQL committed.
- Backfill utility committed and runbook documented.

## Phase 2: API contract and Lambda implementation

1. Extend OpenAPI file:
   - add `POST /query/semantic`,
   - add request schema with:
     - `query_text` (required),
     - optional existing filters (`since`, `until`, `tier`, `handle`, `significant`),
     - `limit` (bounded).
   - add response schema:
     - feed-like items + `score`.
2. Lambda updates (`services/vpc-api-lambda/index.mjs`):
   - new parser/validator for semantic query payload,
   - new handler:
     - generate query embedding,
     - run vector similarity SQL + existing filters,
     - return ranked results.
3. Add `POST /ingest/embeddings/batch`:
   - validate `status_id`, `model`, `dims`, vector payload,
   - upsert both `vector_json` and `embedding`.
4. Auth:
   - require ingest secret for embeddings batch ingest.
   - read routes stay app-auth protected by existing app path.

Deliverables:
- Lambda supports semantic query and embedding ingest.
- OpenAPI and docs updated.

## Phase 3: Embedding generation and ingest pipeline

1. Decide generation owner:
   - Option A (recommended): local/OpenClaw generates post embeddings and ingests them.
   - Option B: API generates embeddings on post ingest (higher API cost/latency).
2. Ensure all new/updated posts receive embeddings.
3. Add idempotent refresh policy:
   - recompute only when text hash changes,
   - skip unchanged rows.
4. Add dead-letter/retry logging for embedding failures.

Deliverables:
- Continuous embedding freshness with deterministic retry behavior.

## Phase 4: Dashboard UX

1. Add NL query input on X Monitor page.
2. Add search mode control:
   - `Keyword` (existing feed `q`),
   - `Semantic` (new API),
   - optional `Hybrid` (future).
3. Show relevance score when semantic mode is used.
4. Keep current filters reusable for semantic calls.
5. Keep pagination behavior explicit (cursor or page token strategy).

Deliverables:
- User can run NL query from UI and view ranked results.

## Phase 5: Validation and rollout

1. Build relevance test set:
   - 20-50 representative NL prompts from original OpenClaw usage.
2. Compare baseline vs semantic:
   - precision@k / human-judged relevance.
3. Run load tests on semantic endpoint.
4. Staged rollout:
   - internal only -> limited users -> default enabled.
5. Add rollback switch:
   - env flag disables semantic path and falls back to lexical.

Deliverables:
- Measured parity and controlled production rollout.

---

## 6) Code touchpoints (repo-specific)

Likely files to update:

- Schema/migrations:
  - `db/migrations/` (new migration for `pgvector` + indices)
- API docs:
  - `docs/openapi.v1.yaml`
  - `docs/POSTGRES_SCHEMA_AND_OPENAPI_V1.md`
- Lambda backend:
  - `services/vpc-api-lambda/index.mjs`
- Validation/parsers:
  - `lib/xmonitor/validators.ts` (if shared route-level validation is needed)
- UI:
  - `app/x-monitor/page.tsx`
  - new semantic-query UI helpers/components under `app/x-monitor/`
- Migration/ops scripts:
  - `scripts/migrate/` (optional backfill utility if done outside SQL)

---

## 7) Environment and secret requirements

Add/confirm:

- `XMONITOR_EMBEDDING_PROVIDER` (set to `venice`)
- `XMONITOR_EMBEDDING_MODEL` (set to `text-embedding-bge-m3`)
- `XMONITOR_EMBEDDING_DIMS` (match existing stored corpus)
- `XMONITOR_EMBEDDING_API_KEY` (Venice API key; server-side secret store)
- optional provider URL setting if needed by implementation (`XMONITOR_EMBEDDING_BASE_URL`)
- optional:
  - `XMONITOR_SEMANTIC_DEFAULT_LIMIT`
  - `XMONITOR_SEMANTIC_MAX_LIMIT`
  - `XMONITOR_SEMANTIC_MIN_SCORE`

Security notes:
- Do not expose provider keys to browser clients.
- Keep NL query embedding generation server-side.

---

## 8) Risks and mitigations

1. Cost growth from embedding generation:
   - cache by text hash,
   - batch generation,
   - model selection by quality/cost target.
2. Relevance drift when changing models:
   - pin model version,
   - dual-run during upgrades,
   - keep model metadata on each embedding row.
3. Dimension mismatch:
   - enforce `dims` checks at ingest.
4. Latency spikes:
   - ANN indexing,
   - timeout budget,
   - graceful fallback to lexical mode.

---

## 9) Definition of done

NL parity is complete when all are true:

- `pgvector`-based semantic retrieval is live in AWS.
- Embedding ingest is part of the production pipeline.
- Dashboard supports NL query and returns ranked results.
- Original OpenClaw-style NL prompts produce acceptable relevance.
- Runbook and API docs include semantic operations and rollback steps.

---

## 10) Suggested execution order

1. Complete direct ingest-to-API cutover milestones from `DIRECT_INGEST_API_TRANSITION_PLAN.md` (single source of truth first).
2. Phase 0 (contract lock; mostly pre-resolved by Venice model decision).
3. Phase 0.5 (value gate using real prompt evaluation).
4. Phase 1 (DB + index + backfill)
5. Phase 2 (API + OpenAPI + Lambda route)
6. Phase 3 (embedding ingest freshness path)
7. Phase 4 (UI)
8. Phase 5 (relevance/load validation and rollout)
