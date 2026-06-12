# Access Control Admin

The access-control admin console lives at `/admin/access`.

## Model

- Users are keyed by email and may include first name, last name, status, pending email, confirmation timestamps, and an admin-only note.
- Groups collect users. Groups also have an admin-only note.
- Roles collect permissions.
- Group role assignments grant a role globally or scoped to one dashboard.
- Effective access is the union of active group memberships, role assignments, role permissions, and assignment scope.
- The current admin interface previews effective access; full session impersonation is reserved for a future audited flow.

## Seeded Groups

- `admins`
- `workspace-members`
- `xmonitor-guests`
- `zodl-roadmap-guests`
- `accrediv-guests`
- `arktouros-guests`

`ACCESS_BOOTSTRAP_ADMIN_EMAILS` seeds emergency admin access. The default is `paul@zodl.com`.

## Adding A Dashboard

1. Add the dashboard to `dashboardCatalog`.
2. Add a `dashboard:<id>:read` permission to migration seed data and backend seed data.
3. Add a group if access should be managed separately.
4. Assign `dashboard-viewer` to the group with dashboard scope `<id>`.
5. Preview a test user in `/admin/access`.

## Access Log

The admin UI combines:

- `auth_login_events`
- `xmonitor_access_events`
- `roadmap_access_events`

Filters support email, event type, dashboard, and time window.
