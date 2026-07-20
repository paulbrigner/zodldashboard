BEGIN;

DELETE FROM dashboard_update_subscriptions
WHERE dashboard_id IN ('regulatory-risk', 'app-store-compliance');

DELETE FROM auth_group_roles
WHERE scope_type = 'dashboard'
  AND scope_key IN ('regulatory-risk', 'app-store-compliance');

DELETE FROM auth_role_permissions
WHERE permission_key IN (
  'dashboard:regulatory-risk:read',
  'dashboard:app-store-compliance:read'
);

DELETE FROM auth_permissions
WHERE permission_key IN (
  'dashboard:regulatory-risk:read',
  'dashboard:app-store-compliance:read'
);

COMMIT;
