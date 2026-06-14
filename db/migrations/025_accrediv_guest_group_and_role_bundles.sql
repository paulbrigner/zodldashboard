INSERT INTO auth_roles(role_key, name, description, is_system)
VALUES
  ('workspace-dashboard-viewer', 'Workspace Dashboard Viewer', 'Read all dashboards intended for internal workspace users.', TRUE),
  ('current-private-dashboard-viewer', 'Current Private Dashboard Viewer', 'Read the current private dashboard bundle: Zodl Roadmap, Accrediv/PGPZ, and Arktouros.', TRUE),
  ('xmonitor-viewer', 'X Monitor Viewer', 'Read the X Monitor dashboard.', TRUE),
  ('zodl-summit-viewer', 'Zodl Summit Viewer', 'Read the 2026 Zodl Summit dashboard.', TRUE)
ON CONFLICT (role_key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

UPDATE auth_roles
SET description = 'Generic dashboard reader for ad hoc scoped dashboard assignments.'
WHERE role_key = 'dashboard-viewer';

INSERT INTO auth_role_permissions(role_key, permission_key)
VALUES
  ('workspace-dashboard-viewer', 'dashboard:x-monitor:read'),
  ('workspace-dashboard-viewer', 'dashboard:zodl-roadmap:read'),
  ('workspace-dashboard-viewer', 'dashboard:pgpz-roadmap:read'),
  ('workspace-dashboard-viewer', 'dashboard:arktouros:read'),
  ('workspace-dashboard-viewer', 'dashboard:2026-zodl-summit:read'),
  ('workspace-dashboard-viewer', 'dashboard:cipherpay-test:read'),
  ('workspace-dashboard-viewer', 'dashboard:regulatory-risk:read'),
  ('workspace-dashboard-viewer', 'dashboard:app-store-compliance:read'),
  ('current-private-dashboard-viewer', 'dashboard:zodl-roadmap:read'),
  ('current-private-dashboard-viewer', 'dashboard:pgpz-roadmap:read'),
  ('current-private-dashboard-viewer', 'dashboard:arktouros:read'),
  ('xmonitor-viewer', 'dashboard:x-monitor:read'),
  ('zodl-summit-viewer', 'dashboard:2026-zodl-summit:read')
ON CONFLICT DO NOTHING;

INSERT INTO auth_group_memberships(group_key, email, expires_at, created_by, created_at)
SELECT 'accrediv-guests', email, expires_at, COALESCE(created_by, 'legacy-env'), created_at
FROM auth_group_memberships
WHERE group_key = 'zodl-roadmap-guests'
ON CONFLICT (group_key, email) DO UPDATE
SET expires_at = COALESCE(EXCLUDED.expires_at, auth_group_memberships.expires_at);

DELETE FROM auth_group_roles
WHERE (group_key, role_key, scope_type, scope_key) IN (
  ('workspace-members', 'dashboard-viewer', 'dashboard', 'x-monitor'),
  ('workspace-members', 'dashboard-viewer', 'dashboard', 'zodl-roadmap'),
  ('workspace-members', 'dashboard-viewer', 'dashboard', 'pgpz-roadmap'),
  ('workspace-members', 'dashboard-viewer', 'dashboard', 'arktouros'),
  ('workspace-members', 'dashboard-viewer', 'dashboard', '2026-zodl-summit'),
  ('workspace-members', 'dashboard-viewer', 'dashboard', 'cipherpay-test'),
  ('workspace-members', 'dashboard-viewer', 'dashboard', 'regulatory-risk'),
  ('workspace-members', 'dashboard-viewer', 'dashboard', 'app-store-compliance'),
  ('xmonitor-guests', 'dashboard-viewer', 'dashboard', 'x-monitor'),
  ('zodl-roadmap-guests', 'dashboard-viewer', 'dashboard', 'zodl-roadmap'),
  ('zodl-roadmap-guests', 'dashboard-viewer', 'dashboard', 'pgpz-roadmap'),
  ('zodl-roadmap-guests', 'dashboard-viewer', 'dashboard', 'arktouros'),
  ('accrediv-guests', 'dashboard-viewer', 'dashboard', 'zodl-roadmap'),
  ('accrediv-guests', 'dashboard-viewer', 'dashboard', 'pgpz-roadmap'),
  ('accrediv-guests', 'dashboard-viewer', 'dashboard', 'arktouros'),
  ('arktouros-guests', 'dashboard-viewer', 'dashboard', 'zodl-roadmap'),
  ('arktouros-guests', 'dashboard-viewer', 'dashboard', 'pgpz-roadmap'),
  ('arktouros-guests', 'dashboard-viewer', 'dashboard', 'arktouros'),
  ('2026-zodl-summit-guests', 'dashboard-viewer', 'dashboard', '2026-zodl-summit')
);

INSERT INTO auth_group_roles(group_key, role_key, scope_type, scope_key)
VALUES
  ('workspace-members', 'workspace-dashboard-viewer', 'global', '*'),
  ('xmonitor-guests', 'xmonitor-viewer', 'global', '*'),
  ('accrediv-guests', 'current-private-dashboard-viewer', 'global', '*'),
  ('arktouros-guests', 'current-private-dashboard-viewer', 'global', '*'),
  ('2026-zodl-summit-guests', 'zodl-summit-viewer', 'global', '*')
ON CONFLICT DO NOTHING;

DELETE FROM auth_groups
WHERE group_key = 'zodl-roadmap-guests';
