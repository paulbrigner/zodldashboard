DROP INDEX IF EXISTS idx_posts_refresh_24h_at;

DROP TABLE IF EXISTS post_metrics_snapshots;
DROP TABLE IF EXISTS reports;

ALTER TABLE posts
  DROP COLUMN IF EXISTS initial_likes,
  DROP COLUMN IF EXISTS initial_reposts,
  DROP COLUMN IF EXISTS initial_replies,
  DROP COLUMN IF EXISTS initial_views,
  DROP COLUMN IF EXISTS likes_24h,
  DROP COLUMN IF EXISTS reposts_24h,
  DROP COLUMN IF EXISTS replies_24h,
  DROP COLUMN IF EXISTS views_24h,
  DROP COLUMN IF EXISTS refresh_24h_at,
  DROP COLUMN IF EXISTS refresh_24h_status,
  DROP COLUMN IF EXISTS refresh_24h_delta_likes,
  DROP COLUMN IF EXISTS refresh_24h_delta_reposts,
  DROP COLUMN IF EXISTS refresh_24h_delta_replies,
  DROP COLUMN IF EXISTS refresh_24h_delta_views;

DELETE FROM pipeline_runs legacy
USING pipeline_runs current_manual
WHERE legacy.mode = 'refresh24h'
  AND current_manual.mode = 'manual'
  AND current_manual.run_at = legacy.run_at
  AND current_manual.source = legacy.source;

UPDATE pipeline_runs
SET
  mode = 'manual',
  note = CASE
    WHEN note IS NULL OR btrim(note) = '' THEN '[legacy refresh24h]'
    ELSE '[legacy refresh24h] ' || note
  END
WHERE mode = 'refresh24h';

ALTER TABLE pipeline_runs
  DROP COLUMN IF EXISTS reported_count;

ALTER TABLE pipeline_runs
  DROP CONSTRAINT IF EXISTS pipeline_runs_mode_check;

ALTER TABLE pipeline_runs
  ADD CONSTRAINT pipeline_runs_mode_check
  CHECK (mode IN ('priority', 'discovery', 'both', 'manual'));
