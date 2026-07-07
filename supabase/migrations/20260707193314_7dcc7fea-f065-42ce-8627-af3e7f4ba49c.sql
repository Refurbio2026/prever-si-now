CREATE TABLE public.company_cache (
  ico text PRIMARY KEY,
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.company_cache TO authenticated;
GRANT ALL ON public.company_cache TO service_role;

ALTER TABLE public.company_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cached companies"
  ON public.company_cache
  FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER update_company_cache_updated_at
  BEFORE UPDATE ON public.company_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();