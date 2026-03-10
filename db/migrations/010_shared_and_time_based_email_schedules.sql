ALTER TABLE scheduled_email_jobs
  ADD COLUMN IF NOT EXISTS visibility TEXT,
  ADD COLUMN IF NOT EXISTS schedule_kind TEXT,
  ADD COLUMN IF NOT EXISTS schedule_days_json JSONB,
  ADD COLUMN IF NOT EXISTS schedule_time_local TEXT;

UPDATE scheduled_email_jobs
SET visibility = COALESCE(NULLIF(TRIM(visibility), ''), 'personal'),
    schedule_kind = COALESCE(NULLIF(TRIM(schedule_kind), ''), 'interval'),
    schedule_days_json = COALESCE(schedule_days_json, '[]'::jsonb)
WHERE visibility IS NULL
   OR schedule_kind IS NULL
   OR schedule_days_json IS NULL;

ALTER TABLE scheduled_email_jobs
  ALTER COLUMN visibility SET DEFAULT 'personal',
  ALTER COLUMN visibility SET NOT NULL,
  ALTER COLUMN schedule_kind SET DEFAULT 'interval',
  ALTER COLUMN schedule_kind SET NOT NULL,
  ALTER COLUMN schedule_days_json SET DEFAULT '[]'::jsonb,
  ALTER COLUMN schedule_days_json SET NOT NULL;

ALTER TABLE scheduled_email_jobs
  DROP CONSTRAINT IF EXISTS chk_scheduled_email_jobs_visibility,
  DROP CONSTRAINT IF EXISTS chk_scheduled_email_jobs_schedule_kind,
  DROP CONSTRAINT IF EXISTS chk_scheduled_email_jobs_schedule_days_json_array,
  DROP CONSTRAINT IF EXISTS chk_scheduled_email_jobs_schedule_time_local,
  DROP CONSTRAINT IF EXISTS chk_scheduled_email_jobs_weekly_config;

ALTER TABLE scheduled_email_jobs
  ADD CONSTRAINT chk_scheduled_email_jobs_visibility
    CHECK (visibility IN ('personal', 'shared')),
  ADD CONSTRAINT chk_scheduled_email_jobs_schedule_kind
    CHECK (schedule_kind IN ('interval', 'weekly')),
  ADD CONSTRAINT chk_scheduled_email_jobs_schedule_days_json_array
    CHECK (jsonb_typeof(schedule_days_json) = 'array'),
  ADD CONSTRAINT chk_scheduled_email_jobs_schedule_time_local
    CHECK (
      schedule_time_local IS NULL
      OR schedule_time_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    ),
  ADD CONSTRAINT chk_scheduled_email_jobs_weekly_config
    CHECK (
      schedule_kind <> 'weekly'
      OR (
        jsonb_array_length(schedule_days_json) > 0
        AND schedule_time_local IS NOT NULL
      )
    );

CREATE INDEX IF NOT EXISTS idx_scheduled_email_jobs_visibility_enabled_next_run
  ON scheduled_email_jobs (visibility, enabled, next_run_at);
