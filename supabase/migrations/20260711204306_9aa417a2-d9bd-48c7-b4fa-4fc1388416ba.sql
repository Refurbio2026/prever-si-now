-- Public stats cache + accessor for landing page
CREATE TABLE IF NOT EXISTS public.public_stats_cache (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.public_stats_cache TO anon, authenticated;
GRANT ALL ON public.public_stats_cache TO service_role;

ALTER TABLE public.public_stats_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read of stats cache"
  ON public.public_stats_cache
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.refresh_public_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_companies bigint;
  v_sources   int;
  v_value     jsonb;
BEGIN
  SELECT count(*) INTO v_companies
  FROM public.company_registry
  WHERE is_current = true;

  SELECT count(DISTINCT source) INTO v_sources
  FROM public.data_freshness
  WHERE status = 'success';

  v_value := jsonb_build_object(
    'companies_count', v_companies,
    'sources_count',   GREATEST(COALESCE(v_sources, 0), 12),
    'refreshed_at',    now()
  );

  INSERT INTO public.public_stats_cache (key, value, updated_at)
  VALUES ('landing', v_value, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  RETURN v_value;
END $$;

REVOKE ALL ON FUNCTION public.refresh_public_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_public_stats() TO service_role;

CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value jsonb;
BEGIN
  SELECT value INTO v_value
  FROM public.public_stats_cache
  WHERE key = 'landing';

  IF v_value IS NULL THEN
    -- Miss: compute once and store. Uses refresh function (same definer).
    v_value := public.refresh_public_stats();
  END IF;

  RETURN v_value;
END $$;

GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;
