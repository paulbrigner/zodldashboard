CREATE TABLE IF NOT EXISTS auth_subjects (
  email CITEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  admin_note TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  email_confirmed_at TIMESTAMPTZ,
  pending_email CITEXT,
  email_change_requested_at TIMESTAMPTZ,
  created_by CITEXT,
  updated_by CITEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_auth_subjects_updated_at ON auth_subjects;
CREATE TRIGGER trg_auth_subjects_updated_at
  BEFORE UPDATE ON auth_subjects
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE auth_subjects
  ADD COLUMN IF NOT EXISTS admin_note TEXT;

CREATE TABLE IF NOT EXISTS auth_groups (
  group_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  admin_note TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_by CITEXT,
  updated_by CITEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_groups_key_format CHECK (group_key ~ '^[a-z0-9][a-z0-9-]*$')
);

DROP TRIGGER IF EXISTS trg_auth_groups_updated_at ON auth_groups;
CREATE TRIGGER trg_auth_groups_updated_at
  BEFORE UPDATE ON auth_groups
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE auth_groups
  ADD COLUMN IF NOT EXISTS admin_note TEXT;

CREATE TABLE IF NOT EXISTS auth_roles (
  role_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_by CITEXT,
  updated_by CITEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_roles_key_format CHECK (role_key ~ '^[a-z0-9][a-z0-9-]*$')
);

DROP TRIGGER IF EXISTS trg_auth_roles_updated_at ON auth_roles;
CREATE TRIGGER trg_auth_roles_updated_at
  BEFORE UPDATE ON auth_roles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS auth_permissions (
  permission_key TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  action TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_permissions_key_format CHECK (permission_key ~ '^[a-z0-9:*._-]+$')
);

CREATE TABLE IF NOT EXISTS auth_role_permissions (
  role_key TEXT NOT NULL REFERENCES auth_roles(role_key) ON UPDATE CASCADE ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES auth_permissions(permission_key) ON UPDATE CASCADE ON DELETE CASCADE,
  created_by CITEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE IF NOT EXISTS auth_group_memberships (
  group_key TEXT NOT NULL REFERENCES auth_groups(group_key) ON UPDATE CASCADE ON DELETE CASCADE,
  email CITEXT NOT NULL REFERENCES auth_subjects(email) ON UPDATE CASCADE ON DELETE CASCADE,
  expires_at TIMESTAMPTZ,
  created_by CITEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_key, email)
);

CREATE INDEX IF NOT EXISTS idx_auth_group_memberships_email
  ON auth_group_memberships (email);

CREATE TABLE IF NOT EXISTS auth_group_roles (
  assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key TEXT NOT NULL REFERENCES auth_groups(group_key) ON UPDATE CASCADE ON DELETE CASCADE,
  role_key TEXT NOT NULL REFERENCES auth_roles(role_key) ON UPDATE CASCADE ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global', 'dashboard')),
  scope_key TEXT NOT NULL DEFAULT '*',
  created_by CITEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_key, role_key, scope_type, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_auth_group_roles_group_key
  ON auth_group_roles (group_key);

CREATE TABLE IF NOT EXISTS auth_invitations (
  invitation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL,
  previous_email CITEXT,
  token_hash TEXT UNIQUE,
  kind TEXT NOT NULL DEFAULT 'welcome'
    CHECK (kind IN ('welcome', 'email-change')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  invited_by CITEXT NOT NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  welcome_email_sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_invitations_email_invited_at_desc
  ON auth_invitations (email, invited_at DESC);

CREATE TABLE IF NOT EXISTS auth_admin_audit_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email CITEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_key TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_admin_audit_events_created_at_desc
  ON auth_admin_audit_events (created_at DESC);

INSERT INTO auth_permissions(permission_key, resource_type, resource_key, action, name, description, is_system)
VALUES
  ('dashboard:*:read', 'dashboard', '*', 'read', 'Read any dashboard', 'Read dashboards when the group-role assignment scope allows it.', TRUE),
  ('dashboard:x-monitor:read', 'dashboard', 'x-monitor', 'read', 'Read X Monitor', 'Open the X Monitor dashboard.', TRUE),
  ('dashboard:zodl-roadmap:read', 'dashboard', 'zodl-roadmap', 'read', 'Read Zodl Roadmap', 'Open the Zodl Roadmap private dashboard.', TRUE),
  ('dashboard:pgpz-roadmap:read', 'dashboard', 'pgpz-roadmap', 'read', 'Read Accrediv Updates', 'Open the Accrediv Updates and PGPZ private dashboard.', TRUE),
  ('dashboard:arktouros:read', 'dashboard', 'arktouros', 'read', 'Read Arktouros', 'Open the Arktouros private dashboard.', TRUE),
  ('dashboard:2026-zodl-summit:read', 'dashboard', '2026-zodl-summit', 'read', 'Read Zodl Summit', 'Open the 2026 Zodl Summit private dashboard.', TRUE),
  ('dashboard:cipherpay-test:read', 'dashboard', 'cipherpay-test', 'read', 'Read CipherPay Test', 'Open the CipherPay Test dashboard.', TRUE),
  ('dashboard:regulatory-risk:read', 'dashboard', 'regulatory-risk', 'read', 'Read Regulatory Risk', 'Open the Regulatory Risk dashboard.', TRUE),
  ('dashboard:app-store-compliance:read', 'dashboard', 'app-store-compliance', 'read', 'Read App Store Dashboard', 'Open the App Store Compliance dashboard.', TRUE),
  ('admin:access-control:manage', 'admin', 'access-control', 'manage', 'Manage access control', 'Manage users, groups, roles, permissions, invitations, and access previews.', TRUE),
  ('admin:access-control:impersonate', 'admin', 'access-control', 'impersonate', 'Impersonate users', 'Reserved for a future fully audited user impersonation session.', TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET resource_type = EXCLUDED.resource_type,
    resource_key = EXCLUDED.resource_key,
    action = EXCLUDED.action,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

INSERT INTO auth_roles(role_key, name, description, is_system)
VALUES
  ('dashboard-viewer', 'Dashboard Viewer', 'Read dashboards within the assignment scope.', TRUE),
  ('access-admin', 'Access Admin', 'Manage access-control users, groups, roles, permissions, and invitations.', TRUE),
  ('impersonation-admin', 'Impersonation Admin', 'Reserved for future audited user impersonation sessions.', TRUE)
ON CONFLICT (role_key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

INSERT INTO auth_role_permissions(role_key, permission_key)
VALUES
  ('dashboard-viewer', 'dashboard:*:read'),
  ('access-admin', 'admin:access-control:manage'),
  ('impersonation-admin', 'admin:access-control:impersonate')
ON CONFLICT DO NOTHING;

INSERT INTO auth_groups(group_key, name, description, is_system)
VALUES
  ('admins', 'Admins', 'Users who can manage access control.', TRUE),
  ('workspace-members', 'Workspace Members', 'Internal workspace users from the allowed Google domain.', TRUE),
  ('xmonitor-guests', 'X Monitor Guests', 'External guests with X Monitor access.', TRUE),
  ('zodl-roadmap-guests', 'Zodl Roadmap Guests', 'External guests for the Zodl Roadmap dashboard.', TRUE),
  ('accrediv-guests', 'Accrediv Guests', 'External guests for Accrediv Updates and PGPZ status.', TRUE),
  ('arktouros-guests', 'Arktouros Guests', 'External guests for the Arktouros dashboard.', TRUE),
  ('2026-zodl-summit-guests', '2026 Zodl Summit Guests', 'External guests for the 2026 Zodl Summit dashboard.', TRUE)
ON CONFLICT (group_key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

INSERT INTO auth_group_roles(group_key, role_key, scope_type, scope_key)
VALUES
  ('admins', 'access-admin', 'global', '*'),
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
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_subjects TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_groups TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_roles TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_permissions TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_role_permissions TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_group_memberships TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_group_roles TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_invitations TO xmonitor_app;
    GRANT SELECT, INSERT ON TABLE auth_admin_audit_events TO xmonitor_app;
  END IF;
END $$;
