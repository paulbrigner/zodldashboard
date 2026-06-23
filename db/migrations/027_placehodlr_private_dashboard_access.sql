INSERT INTO auth_permissions(permission_key, resource_type, resource_key, action, name, description, is_system)
VALUES
  ('dashboard:placehodlr:read', 'dashboard', 'placehodlr', 'read', 'Read Placehodlr', 'Open the Placehodlr private dashboard.', TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET resource_type = EXCLUDED.resource_type,
    resource_key = EXCLUDED.resource_key,
    action = EXCLUDED.action,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

INSERT INTO auth_roles(role_key, name, description, is_system)
VALUES
  ('placehodlr-dashboard-viewer', 'Placehodlr Dashboard Viewer', 'Read the Placehodlr private dashboard.', TRUE)
ON CONFLICT (role_key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

INSERT INTO auth_role_permissions(role_key, permission_key)
VALUES
  ('workspace-dashboard-viewer', 'dashboard:placehodlr:read'),
  ('placehodlr-dashboard-viewer', 'dashboard:placehodlr:read')
ON CONFLICT DO NOTHING;
