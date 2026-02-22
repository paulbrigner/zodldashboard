CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS posts (
  status_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,

  author_handle CITEXT NOT NULL,
  author_display TEXT,

  body_text TEXT,
  posted_relative TEXT,

  source_query TEXT,
  watch_tier TEXT CHECK (watch_tier IN ('teammate', 'influencer', 'ecosystem')),

  is_significant BOOLEAN NOT NULL DEFAULT FALSE,
  significance_reason TEXT,
  significance_version TEXT DEFAULT 'v1',

  likes INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,

  initial_likes INTEGER,
  initial_reposts INTEGER,
  initial_replies INTEGER,
  initial_views INTEGER,

  likes_24h INTEGER,
  reposts_24h INTEGER,
  replies_24h INTEGER,
  views_24h INTEGER,
  refresh_24h_at TIMESTAMPTZ,
  refresh_24h_status TEXT,
  refresh_24h_delta_likes INTEGER,
  refresh_24h_delta_reposts INTEGER,
  refresh_24h_delta_replies INTEGER,
  refresh_24h_delta_views INTEGER,

  discovered_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_discovered_at_desc ON posts (discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_significant_discovered ON posts (is_significant, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_watch_tier_discovered ON posts (watch_tier, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_handle_discovered ON posts (author_handle, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_refresh_24h_at ON posts (refresh_24h_at);

CREATE TABLE IF NOT EXISTS post_metrics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id TEXT NOT NULL REFERENCES posts(status_id) ON DELETE CASCADE,

  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('initial_capture', 'latest_observed', 'refresh_24h')),
  snapshot_at TIMESTAMPTZ NOT NULL,

  likes INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,

  source TEXT DEFAULT 'ingest',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(status_id, snapshot_type, snapshot_at)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_status_time ON post_metrics_snapshots (status_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_type_time ON post_metrics_snapshots (snapshot_type, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS watch_accounts (
  handle CITEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('teammate', 'influencer', 'ecosystem')),
  note TEXT,
  added_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watch_accounts_tier ON watch_accounts (tier, handle);

CREATE TABLE IF NOT EXISTS reports (
  status_id TEXT PRIMARY KEY REFERENCES posts(status_id) ON DELETE CASCADE,
  reported_at TIMESTAMPTZ NOT NULL,
  channel TEXT,
  summary TEXT,
  destination TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_reported_at_desc ON reports (reported_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('priority', 'discovery', 'both', 'refresh24h', 'manual')),

  fetched_count INTEGER NOT NULL DEFAULT 0,
  significant_count INTEGER NOT NULL DEFAULT 0,
  reported_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,

  source TEXT DEFAULT 'local-dispatcher',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(run_at, mode, source)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_mode_run_at_desc ON pipeline_runs (mode, run_at DESC);

CREATE TABLE IF NOT EXISTS embeddings (
  status_id TEXT PRIMARY KEY REFERENCES posts(status_id) ON DELETE CASCADE,

  backend TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector_json JSONB NOT NULL,

  text_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings (model);

DROP TRIGGER IF EXISTS trg_posts_set_updated_at ON posts;
CREATE TRIGGER trg_posts_set_updated_at
BEFORE UPDATE ON posts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_watch_accounts_set_updated_at ON watch_accounts;
CREATE TRIGGER trg_watch_accounts_set_updated_at
BEFORE UPDATE ON watch_accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
