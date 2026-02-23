CREATE TABLE IF NOT EXISTS window_summaries (
  summary_key TEXT PRIMARY KEY,
  window_type TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,

  post_count INTEGER NOT NULL DEFAULT 0,
  significant_count INTEGER NOT NULL DEFAULT 0,

  tier_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  top_themes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  debates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_authors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  notable_posts_json JSONB NOT NULL DEFAULT '[]'::jsonb,

  summary_text TEXT NOT NULL,
  source_version TEXT NOT NULL DEFAULT 'v1',

  embedding_backend TEXT,
  embedding_model TEXT,
  embedding_dims INTEGER,
  embedding_vector_json JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_window_summaries_window_end_desc
  ON window_summaries (window_end DESC);
CREATE INDEX IF NOT EXISTS idx_window_summaries_type_end_desc
  ON window_summaries (window_type, window_end DESC);

CREATE TABLE IF NOT EXISTS narrative_shifts (
  shift_key TEXT PRIMARY KEY,
  basis_window_type TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,

  source_summary_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  emerging_themes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  declining_themes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  debate_intensity_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  position_shifts_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  summary_text TEXT NOT NULL,
  source_version TEXT NOT NULL DEFAULT 'v1',

  embedding_backend TEXT,
  embedding_model TEXT,
  embedding_dims INTEGER,
  embedding_vector_json JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_narrative_shifts_period_end_desc
  ON narrative_shifts (period_end DESC);
CREATE INDEX IF NOT EXISTS idx_narrative_shifts_basis_period_end_desc
  ON narrative_shifts (basis_window_type, period_end DESC);

DROP TRIGGER IF EXISTS trg_window_summaries_set_updated_at ON window_summaries;
CREATE TRIGGER trg_window_summaries_set_updated_at
BEFORE UPDATE ON window_summaries
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_narrative_shifts_set_updated_at ON narrative_shifts;
CREATE TRIGGER trg_narrative_shifts_set_updated_at
BEFORE UPDATE ON narrative_shifts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmonitor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE window_summaries TO xmonitor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE narrative_shifts TO xmonitor_app;
  END IF;
END;
$$;
