# ADR-0001: Use PostgreSQL as the Canonical Cloud Database

- Status: Accepted
- Date: 2026-02-22
- Decision makers: XMonitor Stream A
- Supersedes: None

## Context

XMonitor currently stores source-of-truth data in local SQLite and is moving to AWS for Stream A. The migrated system needs:

- one-time deterministic import from SQLite;
- retry-safe ingest endpoints;
- filter-heavy timeline queries for feed UX;
- simple operational workflows for migrations, backups, and restore.

Two primary storage options were considered for v1: PostgreSQL and DynamoDB.

## Decision

Use PostgreSQL (Aurora PostgreSQL or RDS PostgreSQL) as the canonical cloud database for Stream A.

## Rationale

1. SQLite-to-PostgreSQL migration is direct and low-risk.
2. Feed filters map naturally to relational indexes and SQL predicates.
3. Idempotent ingest upserts are straightforward with `ON CONFLICT` keys.
4. Operationally, backup/restore and schema migrations are predictable for v1.
5. The current team velocity favors fewer modeling and query-shaping tradeoffs.

## Consequences

### Positive

- Faster migration implementation with fewer transforms.
- Clear relational integrity constraints for reports, snapshots, and embeddings.
- Easier ad hoc validation during migration and early production support.

### Negative

- Requires managing connection pooling and SQL migration discipline.
- Horizontal scaling model differs from key-value systems and may require later optimization.

## Deferred items

- `pgvector` adoption is deferred to a later phase.
- Real-time subscriptions and advanced RBAC are out of scope for v1.

## References

- `docs/AWS_MIGRATION_RUNBOOK.md`
- `docs/POSTGRES_SCHEMA_AND_OPENAPI_V1.md`
- `docs/openapi.v1.yaml`
- `README.md`
