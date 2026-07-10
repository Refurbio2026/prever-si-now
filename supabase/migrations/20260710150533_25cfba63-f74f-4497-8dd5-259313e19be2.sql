CREATE OR REPLACE FUNCTION public.close_removed_insurance_debt_keys(
  _provider text,
  _icos text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE affected integer := 0;
BEGIN
  IF COALESCE(array_length(_icos, 1), 0) > 1000 THEN
    RAISE EXCEPTION 'too_many_keys';
  END IF;

  WITH changed AS (
    UPDATE public.company_insurance_debts
    SET is_current = false,
        valid_to = now(),
        removed_at = now()
    WHERE provider = _provider
      AND is_current = true
      AND ico = ANY(_icos)
    RETURNING 1
  )
  SELECT count(*)::integer INTO affected FROM changed;

  RETURN affected;
END $$;

CREATE OR REPLACE FUNCTION public.close_removed_tax_status_keys(
  _dataset text,
  _icos text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE affected integer := 0;
BEGIN
  IF COALESCE(array_length(_icos, 1), 0) > 1000 THEN
    RAISE EXCEPTION 'too_many_keys';
  END IF;

  WITH changed AS (
    UPDATE public.company_tax_status
    SET is_current = false,
        valid_to = now(),
        removed_at = now()
    WHERE source_dataset = _dataset
      AND is_current = true
      AND ico = ANY(_icos)
    RETURNING 1
  )
  SELECT count(*)::integer INTO affected FROM changed;

  RETURN affected;
END $$;

REVOKE ALL ON FUNCTION public.close_removed_insurance_debt_keys(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_removed_tax_status_keys(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_removed_insurance_debt_keys(text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_removed_tax_status_keys(text, text[]) TO service_role;