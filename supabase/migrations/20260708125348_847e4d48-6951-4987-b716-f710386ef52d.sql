
CREATE TABLE public.company_registry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ico TEXT NOT NULL,
  name TEXT,
  legal_form TEXT,
  address TEXT,
  registration_date DATE,
  registration_number TEXT,
  source TEXT NOT NULL DEFAULT 'ORSR',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX company_registry_ico_source_idx ON public.company_registry(ico, source);

GRANT SELECT ON public.company_registry TO anon, authenticated;
GRANT ALL ON public.company_registry TO service_role;

ALTER TABLE public.company_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company registry is publicly readable"
  ON public.company_registry FOR SELECT
  USING (true);

CREATE TRIGGER update_company_registry_updated_at
  BEFORE UPDATE ON public.company_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
