INSERT INTO auth_permissions(permission_key, resource_type, resource_key, action, name, description, is_system)
VALUES
  ('dashboard:2026-zodl-summit:read', 'dashboard', '2026-zodl-summit', 'read', 'Read Zodl Summit', 'Open the 2026 Zodl Summit private dashboard.', TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET resource_type = EXCLUDED.resource_type,
    resource_key = EXCLUDED.resource_key,
    action = EXCLUDED.action,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

INSERT INTO auth_groups(group_key, name, description, is_system)
VALUES
  ('2026-zodl-summit-guests', '2026 Zodl Summit Guests', 'External guests for the 2026 Zodl Summit dashboard.', TRUE)
ON CONFLICT (group_key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

INSERT INTO auth_group_roles(group_key, role_key, scope_type, scope_key)
VALUES
  ('workspace-members', 'dashboard-viewer', 'dashboard', '2026-zodl-summit'),
  ('2026-zodl-summit-guests', 'dashboard-viewer', 'dashboard', '2026-zodl-summit')
ON CONFLICT DO NOTHING;
