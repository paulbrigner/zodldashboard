# Codex Handoff — Regulatory Risk Dashboard (Static-First)

This folder contains **seed data** and a **build plan** for a mostly-static dashboard that feels active via:
- an **activity feed** (change log + signals),
- a **recommendations panel** computed from rules + signals, and
- a **roadmap/status** panel driven by a simple backlog dataset.

## Goal (MVP)
A lightweight internal dashboard that answers:
1) **Where should we avoid** (RED) vs **use caution** (AMBER) vs **base R&D** (GREEN)
2) What is our current **operating posture** (non-custodial guardrails)
3) What **actions** are planned / in progress
4) What the dashboard recommends adding next based on **signals** and **rules**

## Constraints
- Static-first deployment (no database required).
- All content is driven by JSON files in `./data`.
- Optional: load `data_bundle_v1_1.json` from a URL at runtime to update without redeploy.

## Suggested Tech Stack (simple + maintainable)
Option A (recommended): **Next.js** (static export) + TypeScript
- `next build && next export` → deploy to S3/CloudFront, GitHub Pages, or internal static host.

Option B: **Vite + React** + TypeScript
- `vite build` → static output.

Use minimal dependencies. Avoid auth until needed.

## Site Information Architecture (pages)
1) **/ (Home)**
   - Leadership snapshot (counts by tier, next review date, last updated)
   - Top 5 recommendations (computed)
   - Recent changes (change_log + last 5 signals)
   - Roadmap status (task_backlog)

2) **/jurisdictions**
   - Filterable table (tier, region, text search)
   - Row drilldown: summary, guidance, sources, confidence

3) **/features**
   - Feature catalog + “what it triggers”
   - Highlight SERVICE vs WALLET features

4) **/policy**
   - Guardrails (required vs recommended)
   - Operating policy (normal/caution/restricted)

5) **/activity**
   - Change log timeline
   - Signals list
   - “Add a signal” helper (generates JSON snippet to paste into `signals.json`)

## “Appears Active” Mechanics (no backend required)
- **Recommendations panel:** evaluate `recommendation_rules.json` against:
  - current jurisdictions,
  - feature catalog,
  - backlog statuses,
  - review schedule,
  - signals feed.
- **Countdowns:** show days until `review_schedule.next_review_on`.
- **Planned modules:** show “Coming soon” cards from `task_backlog.json` items in `planned`.

## Data Files
You can either load one file:
- `data_bundle_v1_1.json` (single source of truth)

Or load split files:
- `jurisdictions.json`, `feature_catalog.json`, `guardrails.json`, etc.

### Required fields (minimum)
- Jurisdictions: `id, name, tier, risk_summary, team_guidance`
- Guardrails: `id, title, status, detail`
- Task backlog: `id, title, status`

## How updates happen (small team workflow)
1) Edit JSON (or CSV and convert) in a PR.
2) Add a `change_log` entry describing the change.
3) Merge → static rebuild and redeploy.
Optional: host `data_bundle_v1_1.json` separately and fetch at runtime for faster updates.

## Recommendation engine (implementation sketch)
- Load datasets
- Compute:
  - `policy_review_due_in_days = next_review_on - today`
- For each rule:
  - If rule has `signal_type`, check if any signal matches
  - If rule has `any_feature_category`, check feature_catalog
  - If rule has `any_jurisdiction_tier`, check jurisdictions
  - If rule has `policy_review_due_in_days_lte`, compare
- Produce a list of recommendation cards (title, priority, rationale, suggested_tasks)

## Starter acceptance criteria
- Home page renders with no runtime errors and shows:
  - tier counts
  - next review date + countdown
  - top recommendations
  - recent activity
- Jurisdictions page supports filtering and drilldown.
- All content comes from JSON data (no hard-coded jurisdictions).

Generated on: 2026-02-27
