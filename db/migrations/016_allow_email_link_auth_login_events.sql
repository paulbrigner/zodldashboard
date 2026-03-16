ALTER TABLE auth_login_events
  DROP CONSTRAINT IF EXISTS auth_login_events_auth_mode_check;

ALTER TABLE auth_login_events
  ADD CONSTRAINT auth_login_events_auth_mode_check
  CHECK (auth_mode IN ('oauth', 'email-link'));
