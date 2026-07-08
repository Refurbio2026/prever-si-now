
CREATE TABLE public.datahub_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  worker_paused BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
GRANT SELECT, INSERT, UPDATE ON public.datahub_settings TO authenticated;
GRANT ALL ON public.datahub_settings TO service_role;
ALTER TABLE public.datahub_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view settings" ON public.datahub_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update settings" ON public.datahub_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert settings" ON public.datahub_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.datahub_settings (id, worker_paused) VALUES (true, false) ON CONFLICT DO NOTHING;

CREATE TABLE public.datahub_worker_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  trigger_source TEXT NOT NULL DEFAULT 'cron',
  processed INTEGER NOT NULL DEFAULT 0,
  successful INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  paused BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.datahub_worker_runs TO authenticated;
GRANT ALL ON public.datahub_worker_runs TO service_role;
ALTER TABLE public.datahub_worker_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view worker runs" ON public.datahub_worker_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_datahub_worker_runs_started_at ON public.datahub_worker_runs (started_at DESC);
