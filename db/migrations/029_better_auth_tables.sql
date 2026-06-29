BEGIN;

CREATE TABLE IF NOT EXISTS better_auth_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "better_auth_users_email_uidx"
  ON better_auth_users (email);

CREATE TABLE IF NOT EXISTS better_auth_sessions (
  id TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES better_auth_users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "better_auth_sessions_token_uidx"
  ON better_auth_sessions (token);

CREATE INDEX IF NOT EXISTS "better_auth_sessions_userId_idx"
  ON better_auth_sessions ("userId");

CREATE TABLE IF NOT EXISTS better_auth_accounts (
  id TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES better_auth_users(id) ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope TEXT,
  password TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "better_auth_accounts_userId_idx"
  ON better_auth_accounts ("userId");

CREATE INDEX IF NOT EXISTS "better_auth_accounts_provider_account_idx"
  ON better_auth_accounts ("providerId", "accountId");

CREATE TABLE IF NOT EXISTS better_auth_verifications (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "better_auth_verifications_identifier_idx"
  ON better_auth_verifications (identifier);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE better_auth_users TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE better_auth_sessions TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE better_auth_accounts TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE better_auth_verifications TO xmonitor_app;
  END IF;
END $$;

COMMIT;
