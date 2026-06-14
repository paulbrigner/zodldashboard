INSERT INTO auth_roles(role_key, name, description, is_system)
VALUES
  ('zodl-roadmap-viewer', 'Zodl Roadmap Viewer', 'Read the Zodl Roadmap private dashboard.', TRUE),
  ('accrediv-dashboard-viewer', 'Accrediv Dashboard Viewer', 'Read the Accrediv Updates and PGPZ private dashboard.', TRUE),
  ('arktouros-dashboard-viewer', 'Arktouros Dashboard Viewer', 'Read the Arktouros private dashboard.', TRUE)
ON CONFLICT (role_key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

INSERT INTO auth_role_permissions(role_key, permission_key)
VALUES
  ('zodl-roadmap-viewer', 'dashboard:zodl-roadmap:read'),
  ('accrediv-dashboard-viewer', 'dashboard:pgpz-roadmap:read'),
  ('arktouros-dashboard-viewer', 'dashboard:arktouros:read')
ON CONFLICT DO NOTHING;

DELETE FROM auth_group_roles
WHERE (group_key, role_key, scope_type, scope_key) IN (
  ('accrediv-guests', 'current-private-dashboard-viewer', 'global', '*'),
  ('arktouros-guests', 'current-private-dashboard-viewer', 'global', '*')
);

INSERT INTO auth_group_roles(group_key, role_key, scope_type, scope_key)
VALUES
  ('accrediv-guests', 'zodl-roadmap-viewer', 'global', '*'),
  ('accrediv-guests', 'accrediv-dashboard-viewer', 'global', '*'),
  ('arktouros-guests', 'arktouros-dashboard-viewer', 'global', '*')
ON CONFLICT DO NOTHING;

DELETE FROM auth_roles
WHERE role_key = 'current-private-dashboard-viewer';
