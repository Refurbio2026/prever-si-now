
ALTER TABLE public.datahub_settings
  ADD COLUMN IF NOT EXISTS global_import_current_run_id uuid;

CREATE TABLE public.datahub_import_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  source text NOT NULL,
  phase text NOT NULL,
  current_batch integer,
  total_batches integer,
  records_processed integer,
  records_total integer,
  message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, source)
);

GRANT SELECT ON public.datahub_import_progress TO authenticated;
GRANT ALL ON public.datahub_import_progress TO service_role;

ALTER TABLE public.datahub_import_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view import progress"
  ON public.datahub_import_progress
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS datahub_import_progress_updated_at_idx
  ON public.datahub_import_progress (updated_at DESC);

CREATE INDEX IF NOT EXISTS datahub_import_progress_run_id_idx
  ON public.datahub_import_progress (run_id);
