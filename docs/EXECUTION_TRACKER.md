# Execution Tracker

The Execution Tracker is a shared `zodldashboard` capability for selected private dashboards. It is intentionally app-owned:

- `zodldashboard` owns authentication, permissions, UI, APIs, persistence, item event history, and deployment.
- Private dashboard repos own their static HTML/content and should not copy tracker CRUD code.
- A dashboard opts in through `lib/dashboard-catalog.ts` with `supportsExecutionTracker: true`.

## Current opt-in dashboards

- `pgpz-roadmap`
- `arktouros`
- `placehodlr`

## Permissions

Dashboard read permission is not enough to edit tracker state. Mutations require a dashboard-specific tracker permission:

- `dashboard:pgpz-roadmap:track`
- `dashboard:arktouros:track`
- `dashboard:placehodlr:track`

Migration `028_execution_trackers.sql` adds tracker editor roles and grants:

- `workspace-members` -> `workspace-tracker-editor`
- `accrediv-guests` -> `accrediv-tracker-editor`
- `arktouros-guests` -> `arktouros-tracker-editor`

Admins can adjust group-role assignments in the access-control console after the migration is deployed.

## API Surface

- `GET /api/v1/execution-tracker?dashboard_id=<id>`
- `POST /api/v1/execution-tracker`
- `PATCH /api/v1/execution-tracker/items/<itemId>`
- `DELETE /api/v1/execution-tracker/items/<itemId>`

The Next.js routes prefer the VPC backend API when `XMONITOR_BACKEND_API_BASE_URL` and viewer proxy auth are configured, with direct database fallback for local/dev environments.

## Data Model

- `execution_tracker_boards`: dashboard-level board configuration and status columns.
- `execution_tracker_items`: item source of truth, including status, position, assignee, due date, labels, archive state, and optimistic-lock version.
- `execution_tracker_item_events`: mutation history for creates, edits, moves, and archives.

Items are scoped by `dashboard_id` and `board_key`; the initial board key is `default`.
