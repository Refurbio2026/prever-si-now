ALTER TABLE public.datahub_settings
  ADD COLUMN IF NOT EXISTS cron_secret text;