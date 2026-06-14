# Access Control Admin

The access-control admin console lives at `/admin/access`.

## Model

- Users are keyed by email and may include first name, last name, status, pending email, confirmation timestamps, and an admin-only note.
- Groups collect users. Groups also have an admin-only note.
- Roles collect permissions.
- Group role assignments grant a role globally or scoped to one dashboard.
- Effective access is the union of active group memberships, role assignments, role permissions, and assignment scope.
- Seeded groups use role bundles where practical, and guest groups use dashboard-specific viewer roles so permissions live on roles and groups mostly collect users.
- The generic `dashboard-viewer` role remains available for ad hoc scoped dashboard assignments.
- Dashboards marked `visible: false` are omitted from the admin dashboard matrix, permission catalog, role-permission display, and dashboard selectors.
- The current admin interface previews effective access; full session impersonation is reserved for a future audited flow.

## Admin UI

The default `/admin/access` tab is **Overview**. Use it to audit existing access before editing:

- Dashboard Access Matrix shows which groups grant each dashboard and which users inherit that access.
- Group Grants shows each group, its members, its role assignments, and the resolved permissions created by assignment scope.
- Roles shows role permissions and every group assignment using that role.
- Permission Catalog shows every permission and the roles that include it.

Assignment rows in **Overview** include the existing removal action. Use **Users** for a single user's effective access preview, **Groups & Roles** for adding or changing groups, memberships, and dashboard access, and **Access Log** for login/dashboard activity.

In **Groups & Roles**, the everyday dashboard grant path is **Dashboard Access**: pick a group, pick a dashboard, and grant access. The raw role/scope and role-permission forms remain available under **Advanced role and permission controls** for unusual policy edits.

## Seeded Groups

- `admins`
- `workspace-members`
- `xmonitor-guests`
- `accrediv-guests`
- `arktouros-guests`
- `2026-zodl-summit-guests`

## Seeded Roles

- `workspace-dashboard-viewer`
- `zodl-roadmap-viewer`
- `accrediv-dashboard-viewer`
- `arktouros-dashboard-viewer`
- `xmonitor-viewer`
- `zodl-summit-viewer`
- `dashboard-viewer` for ad hoc scoped dashboard grants
- `access-admin`
- `impersonation-admin`

`ACCESS_BOOTSTRAP_ADMIN_EMAILS` seeds emergency admin access. The default is `paul@zodl.com`.

## Adding A Dashboard

1. Add the dashboard to `dashboardCatalog`.
2. Add a `dashboard:<id>:read` permission to migration seed data and backend seed data.
3. Add a group if access should be managed separately.
4. Prefer adding the dashboard permission to an appropriate role bundle, or create a dashboard-specific viewer role and assign that role globally to the group. Use `dashboard-viewer` with dashboard scope `<id>` for one-off scoped grants.
5. Preview a test user in `/admin/access`.

## Access Log

The admin UI combines:

- `auth_login_events`
- `xmonitor_access_events`
- `roadmap_access_events`

Filters support email, event type, dashboard, and time window.
