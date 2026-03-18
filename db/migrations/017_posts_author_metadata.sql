ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS followers_count INTEGER,
  ADD COLUMN IF NOT EXISTS account_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS author_location TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_followers_count
  ON posts (followers_count);

CREATE INDEX IF NOT EXISTS idx_posts_account_created_at
  ON posts (account_created_at);
