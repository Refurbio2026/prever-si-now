
CREATE TABLE public.import_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ico text NOT NULL,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 5,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  force_refresh boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_queue TO authenticated;
GRANT ALL ON public.import_queue TO service_role;

ALTER TABLE public.import_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage import queue"
  ON public.import_queue
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_import_queue_status_priority
  ON public.import_queue (status, priority, created_at);

CREATE INDEX idx_import_queue_ico_source
  ON public.import_queue (ico, source);

-- Prevent duplicate pending/running jobs for same ico + source.
CREATE UNIQUE INDEX idx_import_queue_unique_active
  ON public.import_queue (ico, source)
  WHERE status IN ('pending', 'running');
