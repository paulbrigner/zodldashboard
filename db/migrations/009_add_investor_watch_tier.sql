ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_watch_tier_check;

ALTER TABLE posts
  ADD CONSTRAINT posts_watch_tier_check
  CHECK (watch_tier IN ('teammate', 'investor', 'influencer', 'ecosystem'));

ALTER TABLE watch_accounts
  DROP CONSTRAINT IF EXISTS watch_accounts_tier_check;

ALTER TABLE watch_accounts
  ADD CONSTRAINT watch_accounts_tier_check
  CHECK (tier IN ('teammate', 'investor', 'influencer', 'ecosystem'));
