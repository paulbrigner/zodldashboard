ALTER TABLE auth_login_events
  DROP CONSTRAINT IF EXISTS auth_login_events_access_level_check;

ALTER TABLE auth_login_events
  ADD CONSTRAINT auth_login_events_access_level_check
  CHECK (access_level IN ('workspace', 'guest', 'roadmap-guest'));

ALTER TABLE roadmap_access_events
  DROP CONSTRAINT IF EXISTS roadmap_access_events_access_level_check;

ALTER TABLE roadmap_access_events
  ADD CONSTRAINT roadmap_access_events_access_level_check
  CHECK (access_level IN ('workspace', 'guest', 'roadmap-guest', 'local-bypass'));

ALTER TABLE xmonitor_access_events
  DROP CONSTRAINT IF EXISTS xmonitor_access_events_access_level_check;

ALTER TABLE xmonitor_access_events
  ADD CONSTRAINT xmonitor_access_events_access_level_check
  CHECK (access_level IN ('workspace', 'guest', 'roadmap-guest', 'local-bypass'));
