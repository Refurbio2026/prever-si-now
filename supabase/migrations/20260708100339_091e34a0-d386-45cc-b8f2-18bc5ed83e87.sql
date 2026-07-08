
CREATE TABLE public.company_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ico TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_company_snapshots_ico_created ON public.company_snapshots (ico, created_at DESC);

CREATE TABLE public.company_changes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ico TEXT NOT NULL,
  change_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_company_changes_ico_detected ON public.company_changes (ico, detected_at DESC);

GRANT SELECT ON public.company_snapshots TO authenticated;
GRANT ALL ON public.company_snapshots TO service_role;

GRANT SELECT ON public.company_changes TO authenticated;
GRANT ALL ON public.company_changes TO service_role;

ALTER TABLE public.company_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Snapshots readable by authenticated"
  ON public.company_snapshots FOR SELECT TO authenticated USING (true);

CREATE POLICY "Changes readable by authenticated"
  ON public.company_changes FOR SELECT TO authenticated USING (true);
