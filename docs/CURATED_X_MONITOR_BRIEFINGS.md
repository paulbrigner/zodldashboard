# Curated X Monitor Briefings

Curated briefings are administrator-defined questions that are answered from the
X Monitor corpus on a schedule. They deliberately do **not** expose a free-form
Answer or Compose interface to PGPZ Community members.

## Boundaries

- Published reads use `GET /v1/curated-briefings` and
  `GET /v1/curated-briefings/{slug}`.
- Published callers require `briefings:read`.
- Administrative routes live under `/v1/admin/curated-briefings` and require a
  separate server-only client with both `briefings:read` and
  `briefings:manage`.
- `read`, `semantic:query`, and `briefings:read` do not grant Compose or
  administrative access.
- The Community UI reads only reviewed, published versions. Generation always
  uses `draft_format: none` through the existing async Compose queue and worker.

The PostgreSQL source of truth is migration
`db/migrations/034_curated_topic_briefings.sql`. Topic definitions are mutable,
but every run snapshots the question and generation settings it used, and every
version snapshots its public question, slug, category, evidence, and provenance.
Editing a draft creates a new immutable content revision. Publication, rejection,
supersession, and rollback update review metadata and the topic's published
pointer without combining a newer question with an older answer. Display order
is presentation metadata: published reads use the current topic order while the
version keeps the order captured for its audit history.

Briefing Compose answers use inline X status-ID markers. Generation reconciles
every marker that exists in the bounded evidence set into the stored citation
snapshot, even when the answer needs more than the normal citation-card target.
Markers absent from retrieved evidence are removed, and a draft cannot be
published if its remaining markers are missing from its stored source list.

The scheduler uses a unique idempotency key per topic/due time, and the database
allows at most one queued or running generation per topic. A scheduled run with
the same evidence and generation configuration as the immediately preceding
successful run does not create a duplicate draft. It renews published freshness
only when that same fingerprint backs the current version. The scheduler also
terminalizes stale or orphaned compose jobs so they cannot wedge future topic
refreshes. Failed or unreviewed refreshes never replace the current published
version.

## Safe staged rollout

`XMONITOR_BRIEFINGS_ENABLED` defaults to `false`. Do not add the new capabilities
to the live Secrets Manager client map before the deployed Lambda parser knows
about them: older code rejects the entire client map when it sees an unknown
capability.

1. Back up the current read-client secret payload and the environment maps for
   the API, worker, and scheduler Lambdas.
2. Deploy the parser/routes/worker code only with
   `scripts/aws/deploy_vpc_api_lambda_code_only.sh`. This script changes Lambda
   code and nothing else.
3. Apply migration `034_curated_topic_briefings.sql` using the normal migration
   runner, or run `scripts/aws/apply_curated_briefings_migration.sh`. The helper
   clones the deployed API code and VPC placement into an isolated one-shot
   Lambda, applies the migration with `xmonitor/rds/master`, and deletes the
   temporary function on exit. It never places the privileged migration
   credential on the API Gateway-backed production function. Confirm all three
   tables and the active-run partial unique index.
4. Smoke-check existing feed, semantic, Compose, worker, and scheduler behavior
   while briefings remain disabled.
5. Update the existing `pgpz-community` client to include
   `briefings:read`. Create a different administrator credential with
   `capabilities: ["briefings:read", "briefings:manage"]`. Keep a copy of the
   pre-change secret payload for rollback.
6. Set `XMONITOR_BRIEFINGS_ENABLED=true` on the API, compose worker, and scheduler
   without changing their other environment variables. Optionally set
   `XMONITOR_BRIEFING_DISPATCH_LIMIT` and
   `XMONITOR_BRIEFING_PROMPT_VERSION` on all three.
7. Create topics through the administrator API, run one manual refresh, review
   its citations and corpus timestamps, publish it, then verify the published
   read endpoints before enabling the Community page.

If Lambda code must be rolled back to a version that predates briefing
capabilities, restore the backed-up read-client secret first (removing
`briefings:read` and `briefings:manage`), wait for the five-minute authentication
cache window, and only then roll back the code. Otherwise the old parser will
reject every configured read client.

Avoid using the full provisioning script for a code-only production rollout. It
also reconciles IAM, VPC configuration, Lambda environment maps, SQS,
EventBridge, and API Gateway. The full script now preserves/passes the briefing
settings and validates both capabilities, but it is intentionally a broader
operation.
