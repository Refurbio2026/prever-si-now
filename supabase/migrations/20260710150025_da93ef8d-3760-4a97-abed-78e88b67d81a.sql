CREATE INDEX IF NOT EXISTS company_insurance_debts_provider_current_ico_idx
  ON public.company_insurance_debts (provider, is_current, ico);

CREATE INDEX IF NOT EXISTS company_tax_status_dataset_current_ico_idx
  ON public.company_tax_status (source_dataset, is_current, ico);

CREATE OR REPLACE FUNCTION public.reconcile_insurance_deactivate_batch(
  _provider text,
  _run_id uuid,
  _after_ico text,
  _limit int
)
RETURNS TABLE(last_ico text, scanned int, deactivated int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Deprecated safety shim: removed-key detection is intentionally done in
  -- application code with paginated key diffs, then closed by key chunks.
  RETURN QUERY SELECT NULL::text, 0, 0;
END $$;

CREATE OR REPLACE FUNCTION public.reconcile_tax_dataset_deactivate_batch(
  _dataset text,
  _run_id uuid,
  _after_ico text,
  _limit int
)
RETURNS TABLE(last_ico text, scanned int, deactivated int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Deprecated safety shim: removed-key detection is intentionally done in
  -- application code with paginated key diffs, then closed by key chunks.
  RETURN QUERY SELECT NULL::text, 0, 0;
END $$;

GRANT EXECUTE ON FUNCTION public.reconcile_insurance_deactivate_batch(text, uuid, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_tax_dataset_deactivate_batch(text, uuid, text, int) TO service_role;