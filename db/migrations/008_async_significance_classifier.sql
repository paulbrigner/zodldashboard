ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS classification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (classification_status IN ('pending', 'processing', 'classified', 'failed')),
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS classification_model TEXT,
  ADD COLUMN IF NOT EXISTS classification_confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS classification_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS classification_error TEXT,
  ADD COLUMN IF NOT EXISTS classification_leased_at TIMESTAMPTZ;

ALTER TABLE posts
  ALTER COLUMN significance_version SET DEFAULT 'ai_v1';

CREATE INDEX IF NOT EXISTS idx_posts_classification_status_discovered
  ON posts (classification_status, discovered_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_classification_status_leased
  ON posts (classification_status, classification_leased_at);

CREATE INDEX IF NOT EXISTS idx_posts_classified_significant_discovered
  ON posts (classification_status, is_significant, discovered_at DESC);

UPDATE posts
SET
  is_significant = FALSE,
  significance_reason = NULL,
  significance_version = 'ai_v1',
  classification_status = 'pending',
  classified_at = NULL,
  classification_model = NULL,
  classification_confidence = NULL,
  classification_attempts = 0,
  classification_error = NULL,
  classification_leased_at = NULL,
  updated_at = now();
