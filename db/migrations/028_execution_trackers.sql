CREATE TABLE IF NOT EXISTS execution_tracker_boards (
  dashboard_id TEXT NOT NULL,
  board_key TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL DEFAULT 'Execution Tracker',
  status_config JSONB NOT NULL DEFAULT
    '[
      {"key":"not-started","label":"Not Yet Started"},
      {"key":"in-progress","label":"In Progress"},
      {"key":"drafting","label":"Drafting"},
      {"key":"reviewing","label":"Reviewing"},
      {"key":"finalizing","label":"Finalizing"},
      {"key":"publishing","label":"Publishing"},
      {"key":"complete","label":"Complete","terminal":true}
    ]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by CITEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dashboard_id, board_key),
  CHECK (length(trim(dashboard_id)) > 0),
  CHECK (length(trim(board_key)) > 0),
  CHECK (length(trim(title)) > 0)
);

DROP TRIGGER IF EXISTS trg_execution_tracker_boards_set_updated_at ON execution_tracker_boards;
CREATE TRIGGER trg_execution_tracker_boards_set_updated_at
BEFORE UPDATE ON execution_tracker_boards
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS execution_tracker_items (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id TEXT NOT NULL,
  board_key TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  description TEXT,
  status_key TEXT NOT NULL,
  position NUMERIC(14, 6) NOT NULL DEFAULT 0,
  assignee TEXT,
  due_date DATE,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by CITEXT NOT NULL,
  updated_by CITEXT,
  archived_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT execution_tracker_items_board_fk
    FOREIGN KEY (dashboard_id, board_key)
    REFERENCES execution_tracker_boards(dashboard_id, board_key)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CHECK (length(trim(title)) > 0),
  CHECK (jsonb_typeof(labels) = 'array'),
  CHECK (jsonb_typeof(links) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_execution_tracker_items_board_status_position
  ON execution_tracker_items (dashboard_id, board_key, status_key, archived_at, position, created_at);

CREATE INDEX IF NOT EXISTS idx_execution_tracker_items_updated_at
  ON execution_tracker_items (dashboard_id, updated_at DESC);

DROP TRIGGER IF EXISTS trg_execution_tracker_items_set_updated_at ON execution_tracker_items;
CREATE TRIGGER trg_execution_tracker_items_set_updated_at
BEFORE UPDATE ON execution_tracker_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS execution_tracker_item_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID REFERENCES execution_tracker_items(item_id) ON DELETE SET NULL,
  dashboard_id TEXT NOT NULL,
  board_key TEXT NOT NULL DEFAULT 'default',
  actor_email CITEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'moved', 'archived', 'restored')),
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_tracker_item_events_dashboard_created_at
  ON execution_tracker_item_events (dashboard_id, board_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_tracker_item_events_item_created_at
  ON execution_tracker_item_events (item_id, created_at DESC);

INSERT INTO auth_permissions(permission_key, resource_type, resource_key, action, name, description, is_system)
VALUES
  ('dashboard:pgpz-roadmap:track', 'dashboard', 'pgpz-roadmap', 'track', 'Edit PGPZ execution tracker', 'Create, update, move, and archive PGPZ roadmap tracker items.', TRUE),
  ('dashboard:arktouros:track', 'dashboard', 'arktouros', 'track', 'Edit Arktouros execution tracker', 'Create, update, move, and archive Arktouros tracker items.', TRUE),
  ('dashboard:placehodlr:track', 'dashboard', 'placehodlr', 'track', 'Edit Placehodlr execution tracker', 'Create, update, move, and archive Placehodlr tracker items.', TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET resource_type = EXCLUDED.resource_type,
    resource_key = EXCLUDED.resource_key,
    action = EXCLUDED.action,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

INSERT INTO auth_roles(role_key, name, description, is_system)
VALUES
  ('workspace-tracker-editor', 'Workspace Tracker Editor', 'Edit execution trackers on selected workspace dashboards.', TRUE),
  ('accrediv-tracker-editor', 'Accrediv Tracker Editor', 'Edit the PGPZ roadmap execution tracker.', TRUE),
  ('arktouros-tracker-editor', 'Arktouros Tracker Editor', 'Edit the Arktouros execution tracker.', TRUE),
  ('placehodlr-tracker-editor', 'Placehodlr Tracker Editor', 'Edit the Placehodlr execution tracker.', TRUE)
ON CONFLICT (role_key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

INSERT INTO auth_role_permissions(role_key, permission_key)
VALUES
  ('workspace-tracker-editor', 'dashboard:pgpz-roadmap:track'),
  ('workspace-tracker-editor', 'dashboard:arktouros:track'),
  ('workspace-tracker-editor', 'dashboard:placehodlr:track'),
  ('accrediv-tracker-editor', 'dashboard:pgpz-roadmap:track'),
  ('arktouros-tracker-editor', 'dashboard:arktouros:track'),
  ('placehodlr-tracker-editor', 'dashboard:placehodlr:track')
ON CONFLICT DO NOTHING;

INSERT INTO auth_group_roles(group_key, role_key, scope_type, scope_key)
VALUES
  ('workspace-members', 'workspace-tracker-editor', 'global', '*'),
  ('accrediv-guests', 'accrediv-tracker-editor', 'global', '*'),
  ('arktouros-guests', 'arktouros-tracker-editor', 'global', '*')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE execution_tracker_boards TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE execution_tracker_items TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE execution_tracker_item_events TO xmonitor_app;
  END IF;
END;
$$;
