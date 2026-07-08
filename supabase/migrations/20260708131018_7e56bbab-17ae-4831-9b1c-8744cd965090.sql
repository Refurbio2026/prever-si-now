
CREATE TABLE public.import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ico text NOT NULL,
  source text NOT NULL,
  status text NOT NULL,
  records_count integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX idx_import_logs_ico ON public.import_logs(ico);
CREATE INDEX idx_import_logs_started_at ON public.import_logs(started_at DESC);

GRANT SELECT ON public.import_logs TO authenticated;
GRANT ALL ON public.import_logs TO service_role;

ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view import logs"
ON public.import_logs FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
