DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'xmonitor_briefing_topics'
      AND column_name = 'publication_enabled'
  ) THEN
    ALTER TABLE xmonitor_briefing_topics
      ADD COLUMN publication_enabled BOOLEAN NOT NULL DEFAULT TRUE;

    -- Preserve the former coupled behavior during the one-time migration.
    UPDATE xmonitor_briefing_topics
    SET publication_enabled = enabled;
  END IF;
END
$$;

ALTER TABLE xmonitor_briefing_topics
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

DROP INDEX IF EXISTS idx_xmonitor_briefing_topics_due;
CREATE INDEX idx_xmonitor_briefing_topics_due
  ON xmonitor_briefing_topics (next_refresh_at, display_order)
  WHERE enabled AND archived_at IS NULL;
