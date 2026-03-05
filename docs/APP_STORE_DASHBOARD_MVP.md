# App Store Dashboard (Alpha/MVP)

This document describes the initial implementation of the **App Store Compliance & Submissions** dashboard.

## Scope delivered

Routes:

- `/app-stores` (Overview)
- `/app-stores/submissions`
- `/app-stores/declarations`
- `/app-stores/matrix`
- `/app-stores/reviewer-comms`
- `/app-stores/evidence-vault`
- `/app-stores/settings`

Access:

- Workspace users and local-bypass users can access `/app-stores/*`.
- Guest users are redirected to `/`.

Data model (MVP):

- Implemented as typed seed data in `lib/app-stores/data.ts`.
- Types in `lib/app-stores/types.ts` mirror the high-level schema in the product spec.
- Derived KPIs/alerts are computed in `lib/app-stores/insights.ts`.

## Functional highlights

### Overview

- KPI cards for blockers, deadlines, open reviewer threads, affected jurisdictions, unreviewed feature changes.
- Critical alerts list with severity tags.
- Current release trains table.
- Declaration status summary by store/declaration type.

### Submissions

- Submission runs table.
- Submission detail view (selected row) with:
  - checklist snapshot,
  - declarations touched,
  - assets used,
  - blockers,
  - outcome and lessons learned.

### Declarations & Licensing

- Declaration coverage table:
  - scope, region, status, deadlines, docs requirement, decision, sign-off.
- Explicit **Apple DSA trader-status tracking**:
  - question prompt,
  - selected option,
  - impact note,
  - sign-off and review date.
- Region detail view:
  - answer snapshot,
  - decision/rationale,
  - source links.

### Feature-to-Claim Matrix

- Feature matrix covering custody/swaps/fees/KYC/geofencing/advice-avoidance hooks.
- Jurisdictional availability table.
- Statement-pack preview generated from feature metadata.
- Feature change diff report with review flags.

### Reviewer Comms / Cases

- Case table across stores.
- Case detail panel:
  - policy citations,
  - attachments,
  - resolution notes,
  - message timeline.

### Evidence Vault

- Structured evidence inventory with metadata.
- Submission evidence bundles and bundle preview.

### Settings

- MVP role model and permissions summary.
- Integration status (GitHub/Slack/console ingestion roadmap).
- Gate policy and persistence notes.

## Current limitations

- No persistent writes yet (seeded data only).
- No file upload pipeline in this MVP.
- No automated ingestion from App Store Connect / Play Console yet.
- No immutable snapshot hashing/export package generation yet.

## Next implementation steps

1. Add Postgres schema/migrations for app-stores entities.
2. Add API routes for CRUD + append-only audit logs.
3. Add upload/storage integration for evidence (S3 + metadata rows).
4. Add workflow actions for checklist approvals/sign-offs.
5. Add optional integrations:
   - GitHub release triggers,
   - Slack alerting,
   - best-effort store status sync.
