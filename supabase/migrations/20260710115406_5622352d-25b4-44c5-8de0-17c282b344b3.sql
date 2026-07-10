ALTER TABLE public.datahub_settings
  ADD COLUMN IF NOT EXISTS global_import_running boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS global_import_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS global_import_last_finished_at timestamptz;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;