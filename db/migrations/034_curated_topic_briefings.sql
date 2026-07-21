CREATE TABLE IF NOT EXISTS xmonitor_briefing_topics (
  topic_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  question TEXT NOT NULL
    CHECK (char_length(question) BETWEEN 10 AND 1000),
  category TEXT,
  editorial_context TEXT,
  retrieval_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  answer_style TEXT NOT NULL DEFAULT 'detailed'
    CHECK (answer_style IN ('brief', 'balanced', 'detailed')),
  refresh_interval_minutes INTEGER NOT NULL DEFAULT 1440
    CHECK (refresh_interval_minutes BETWEEN 60 AND 10080),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  next_refresh_at TIMESTAMPTZ,
  last_scheduled_at TIMESTAMPTZ,
  current_published_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS xmonitor_briefing_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES xmonitor_briefing_topics(topic_id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  trigger_source TEXT NOT NULL
    CHECK (trigger_source IN ('scheduled', 'manual')),
  idempotency_key TEXT NOT NULL UNIQUE,
  compose_job_id UUID UNIQUE REFERENCES compose_jobs(job_id) ON DELETE SET NULL,
  topic_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  corpus_from TIMESTAMPTZ,
  corpus_through TIMESTAMPTZ,
  evidence_fingerprint TEXT,
  error_code TEXT,
  error_message TEXT,
  requested_by_client_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS xmonitor_briefing_versions (
  version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES xmonitor_briefing_topics(topic_id) ON DELETE CASCADE,
  run_id UUID UNIQUE REFERENCES xmonitor_briefing_runs(run_id) ON DELETE RESTRICT,
  source_version_id UUID REFERENCES xmonitor_briefing_versions(version_id) ON DELETE SET NULL,
  version_number INTEGER NOT NULL,
  slug TEXT NOT NULL
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  question TEXT NOT NULL
    CHECK (char_length(question) BETWEEN 10 AND 1000),
  category TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  topic_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_fingerprint TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft', 'published', 'rejected', 'superseded')),
  answer_text TEXT NOT NULL,
  key_points_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  citations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  retrieval_stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  corpus_from TIMESTAMPTZ,
  corpus_through TIMESTAMPTZ,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stale_after TIMESTAMPTZ NOT NULL,
  embedding_model TEXT,
  synthesis_model TEXT,
  prompt_version TEXT NOT NULL DEFAULT 'curated-briefing-v1',
  provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_client_id TEXT,
  created_by_client_id TEXT,
  published_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (topic_id, version_number)
);

ALTER TABLE xmonitor_briefing_topics
  DROP CONSTRAINT IF EXISTS fk_xmonitor_briefing_topics_published_version;
ALTER TABLE xmonitor_briefing_topics
  ADD CONSTRAINT fk_xmonitor_briefing_topics_published_version
  FOREIGN KEY (current_published_version_id)
  REFERENCES xmonitor_briefing_versions(version_id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_xmonitor_briefing_topics_due
  ON xmonitor_briefing_topics (next_refresh_at, display_order)
  WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_xmonitor_briefing_runs_topic_created
  ON xmonitor_briefing_runs (topic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_xmonitor_briefing_runs_status_created
  ON xmonitor_briefing_runs (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_xmonitor_briefing_runs_one_active_per_topic
  ON xmonitor_briefing_runs (topic_id)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_xmonitor_briefing_versions_topic_created
  ON xmonitor_briefing_versions (topic_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_xmonitor_briefing_versions_published
  ON xmonitor_briefing_versions (published_at DESC)
  WHERE review_status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS idx_xmonitor_briefing_versions_one_published_per_topic
  ON xmonitor_briefing_versions (topic_id)
  WHERE review_status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS idx_xmonitor_briefing_versions_unique_published_slug
  ON xmonitor_briefing_versions (slug)
  WHERE review_status = 'published';

CREATE OR REPLACE FUNCTION prevent_xmonitor_briefing_version_content_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.topic_id IS DISTINCT FROM OLD.topic_id
    OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.source_version_id IS DISTINCT FROM OLD.source_version_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.slug IS DISTINCT FROM OLD.slug
    OR NEW.question IS DISTINCT FROM OLD.question
    OR NEW.category IS DISTINCT FROM OLD.category
    OR NEW.display_order IS DISTINCT FROM OLD.display_order
    OR NEW.topic_snapshot_json IS DISTINCT FROM OLD.topic_snapshot_json
    OR NEW.evidence_fingerprint IS DISTINCT FROM OLD.evidence_fingerprint
    OR NEW.answer_text IS DISTINCT FROM OLD.answer_text
    OR NEW.key_points_json IS DISTINCT FROM OLD.key_points_json
    OR NEW.citations_json IS DISTINCT FROM OLD.citations_json
    OR NEW.retrieval_stats_json IS DISTINCT FROM OLD.retrieval_stats_json
    OR NEW.source_count IS DISTINCT FROM OLD.source_count
    OR NEW.corpus_from IS DISTINCT FROM OLD.corpus_from
    OR NEW.corpus_through IS DISTINCT FROM OLD.corpus_through
    OR NEW.generated_at IS DISTINCT FROM OLD.generated_at
    OR NEW.embedding_model IS DISTINCT FROM OLD.embedding_model
    OR NEW.synthesis_model IS DISTINCT FROM OLD.synthesis_model
    OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
    OR NEW.provenance_json IS DISTINCT FROM OLD.provenance_json
    OR NEW.created_by_client_id IS DISTINCT FROM OLD.created_by_client_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'curated briefing version content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_xmonitor_briefing_versions_immutable_content
  ON xmonitor_briefing_versions;
CREATE TRIGGER trg_xmonitor_briefing_versions_immutable_content
BEFORE UPDATE ON xmonitor_briefing_versions
FOR EACH ROW
EXECUTE FUNCTION prevent_xmonitor_briefing_version_content_update();

DROP TRIGGER IF EXISTS trg_xmonitor_briefing_topics_set_updated_at ON xmonitor_briefing_topics;
CREATE TRIGGER trg_xmonitor_briefing_topics_set_updated_at
BEFORE UPDATE ON xmonitor_briefing_topics
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE xmonitor_briefing_topics TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE xmonitor_briefing_runs TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE xmonitor_briefing_versions TO xmonitor_app;
  END IF;
END;
$$;
