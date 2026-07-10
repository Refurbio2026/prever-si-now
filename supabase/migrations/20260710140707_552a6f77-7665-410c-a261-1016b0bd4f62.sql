-- Batched reconciliation RPCs. Each call processes at most _limit staging rows
-- ordered by ico (keyset pagination), so no single statement scans the full
-- dataset. Safety property preserved: reconciliation only sets is_current=false
-- with valid_to/removed_at, never DELETEs from company_* tables. A mid-run
-- failure leaves production consistent (some icos migrated to the new snapshot,
-- others still on the old one; next successful run finishes the job).

-- ============ INSURANCE ============

CREATE OR REPLACE FUNCTION public.reconcile_insurance_debts_batch(
  _provider text,
  _run_id uuid,
  _source_date date,
  _after_ico text,
  _limit int
)
RETURNS TABLE(last_ico text, processed int, inserted int, updated int, unchanged int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ins int := 0; upd int := 0; unc int := 0; proc int := 0; last text;
BEGIN
  CREATE TEMP TABLE _batch ON COMMIT DROP AS
    SELECT s.*
    FROM staging_insurance_debts s
    WHERE s.run_id = _run_id
      AND s.provider = _provider
      AND s.ico > COALESCE(_after_ico, '')
    ORDER BY s.ico
    LIMIT _limit;

  SELECT count(*)::int, max(ico) INTO proc, last FROM _batch;
  IF proc = 0 THEN
    RETURN QUERY SELECT NULL::text, 0, 0, 0, 0;
    RETURN;
  END IF;

  WITH new_rows AS (
    INSERT INTO company_insurance_debts (
      ico, provider, debtor_found, debt_amount, currency, debtor_name, address,
      source_record_date, source_url, raw_data, source_record_hash,
      source_import_run_id, is_current, first_seen_at, last_seen_at, valid_from
    )
    SELECT b.ico, b.provider, true, b.debt_amount, COALESCE(b.currency,'EUR'),
           b.debtor_name, b.address, _source_date, b.source_url, b.raw_data,
           b.source_record_hash, _run_id, true, now(), now(), now()
    FROM _batch b
    WHERE NOT EXISTS (
      SELECT 1 FROM company_insurance_debts c
      WHERE c.ico = b.ico AND c.provider = _provider AND c.is_current
    )
    RETURNING 1
  ) SELECT count(*)::int INTO ins FROM new_rows;

  WITH same AS (
    UPDATE company_insurance_debts c
    SET last_seen_at = now(),
        imported_at = now(),
        source_import_run_id = _run_id
    FROM _batch b
    WHERE c.ico = b.ico AND c.provider = b.provider AND c.is_current
      AND c.source_record_hash IS NOT DISTINCT FROM b.source_record_hash
    RETURNING 1
  ) SELECT count(*)::int INTO unc FROM same;

  WITH changed_pairs AS (
    SELECT b.ico, b.provider, b.debt_amount, b.currency, b.debtor_name,
           b.address, b.source_url, b.raw_data, b.source_record_hash
    FROM _batch b
    JOIN company_insurance_debts c
      ON c.ico = b.ico AND c.provider = b.provider AND c.is_current
    WHERE c.source_record_hash IS DISTINCT FROM b.source_record_hash
  ),
  closed AS (
    UPDATE company_insurance_debts c
    SET is_current = false, valid_to = now()
    FROM changed_pairs cp
    WHERE c.ico = cp.ico AND c.provider = cp.provider AND c.is_current
    RETURNING 1
  ),
  inserted_new AS (
    INSERT INTO company_insurance_debts (
      ico, provider, debtor_found, debt_amount, currency, debtor_name, address,
      source_record_date, source_url, raw_data, source_record_hash,
      source_import_run_id, is_current, first_seen_at, last_seen_at, valid_from
    )
    SELECT cp.ico, cp.provider, true, cp.debt_amount, COALESCE(cp.currency,'EUR'),
           cp.debtor_name, cp.address, _source_date, cp.source_url, cp.raw_data,
           cp.source_record_hash, _run_id, true, now(), now(), now()
    FROM changed_pairs cp
    RETURNING 1
  )
  SELECT count(*)::int INTO upd FROM inserted_new;

  DROP TABLE _batch;
  RETURN QUERY SELECT last, proc, ins, upd, unc;
END $$;

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
DECLARE d int := 0; scn int := 0; last text;
BEGIN
  CREATE TEMP TABLE _scan ON COMMIT DROP AS
    SELECT c.ico
    FROM company_insurance_debts c
    WHERE c.provider = _provider
      AND c.is_current
      AND c.ico > COALESCE(_after_ico, '')
    ORDER BY c.ico
    LIMIT _limit;

  SELECT count(*)::int, max(ico) INTO scn, last FROM _scan;
  IF scn = 0 THEN
    RETURN QUERY SELECT NULL::text, 0, 0;
    RETURN;
  END IF;

  WITH gone AS (
    UPDATE company_insurance_debts c
    SET is_current = false, valid_to = now(), removed_at = now()
    WHERE c.provider = _provider
      AND c.is_current
      AND c.ico IN (SELECT ico FROM _scan)
      AND NOT EXISTS (
        SELECT 1 FROM staging_insurance_debts s
        WHERE s.run_id = _run_id AND s.provider = _provider AND s.ico = c.ico
      )
    RETURNING 1
  ) SELECT count(*)::int INTO d FROM gone;

  DROP TABLE _scan;
  RETURN QUERY SELECT last, scn, d;
END $$;

CREATE OR REPLACE FUNCTION public.reconcile_insurance_cleanup(_run_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM staging_insurance_debts WHERE run_id = _run_id;
$$;

-- ============ TAX ============

CREATE OR REPLACE FUNCTION public.reconcile_tax_dataset_batch(
  _dataset text,
  _run_id uuid,
  _source_date date,
  _after_ico text,
  _limit int
)
RETURNS TABLE(last_ico text, processed int, inserted int, updated int, unchanged int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ins int := 0; upd int := 0; unc int := 0; proc int := 0; last text;
BEGIN
  CREATE TEMP TABLE _batch ON COMMIT DROP AS
    SELECT s.*
    FROM staging_tax_records s
    WHERE s.run_id = _run_id
      AND s.dataset = _dataset
      AND s.ico > COALESCE(_after_ico, '')
    ORDER BY s.ico
    LIMIT _limit;

  SELECT count(*)::int, max(ico) INTO proc, last FROM _batch;
  IF proc = 0 THEN
    RETURN QUERY SELECT NULL::text, 0, 0, 0, 0;
    RETURN;
  END IF;

  WITH new_rows AS (
    INSERT INTO company_tax_status (
      ico, source_dataset, tax_debtor_found, tax_debt_amount, vat_registered, ic_dph,
      vat_registration_date, tax_reliability_index, source_record_date, source_url,
      raw_data, source_record_hash, source_import_run_id, is_current,
      first_seen_at, last_seen_at, valid_from
    )
    SELECT b.ico, b.dataset, b.tax_debtor_found, b.tax_debt_amount, b.vat_registered,
           b.ic_dph, b.vat_registration_date, b.tax_reliability_index, _source_date,
           b.source_url, b.raw_data, b.source_record_hash, _run_id, true,
           now(), now(), now()
    FROM _batch b
    WHERE NOT EXISTS (
      SELECT 1 FROM company_tax_status c
      WHERE c.ico = b.ico AND c.source_dataset = _dataset AND c.is_current
    )
    RETURNING 1
  ) SELECT count(*)::int INTO ins FROM new_rows;

  WITH same AS (
    UPDATE company_tax_status c
    SET last_seen_at = now(), imported_at = now(), source_import_run_id = _run_id
    FROM _batch b
    WHERE c.ico = b.ico AND c.source_dataset = b.dataset AND c.is_current
      AND c.source_record_hash IS NOT DISTINCT FROM b.source_record_hash
    RETURNING 1
  ) SELECT count(*)::int INTO unc FROM same;

  WITH changed_pairs AS (
    SELECT b.ico, b.dataset, b.tax_debtor_found, b.tax_debt_amount, b.vat_registered,
           b.ic_dph, b.vat_registration_date, b.tax_reliability_index,
           b.source_url, b.raw_data, b.source_record_hash
    FROM _batch b
    JOIN company_tax_status c
      ON c.ico = b.ico AND c.source_dataset = b.dataset AND c.is_current
    WHERE c.source_record_hash IS DISTINCT FROM b.source_record_hash
  ),
  closed AS (
    UPDATE company_tax_status c
    SET is_current = false, valid_to = now()
    FROM changed_pairs cp
    WHERE c.ico = cp.ico AND c.source_dataset = cp.dataset AND c.is_current
    RETURNING 1
  ),
  inserted_new AS (
    INSERT INTO company_tax_status (
      ico, source_dataset, tax_debtor_found, tax_debt_amount, vat_registered, ic_dph,
      vat_registration_date, tax_reliability_index, source_record_date, source_url,
      raw_data, source_record_hash, source_import_run_id, is_current,
      first_seen_at, last_seen_at, valid_from
    )
    SELECT cp.ico, cp.dataset, cp.tax_debtor_found, cp.tax_debt_amount, cp.vat_registered,
           cp.ic_dph, cp.vat_registration_date, cp.tax_reliability_index, _source_date,
           cp.source_url, cp.raw_data, cp.source_record_hash, _run_id, true,
           now(), now(), now()
    FROM changed_pairs cp
    RETURNING 1
  )
  SELECT count(*)::int INTO upd FROM inserted_new;

  DROP TABLE _batch;
  RETURN QUERY SELECT last, proc, ins, upd, unc;
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
DECLARE d int := 0; scn int := 0; last text;
BEGIN
  CREATE TEMP TABLE _scan ON COMMIT DROP AS
    SELECT c.ico
    FROM company_tax_status c
    WHERE c.source_dataset = _dataset
      AND c.is_current
      AND c.ico > COALESCE(_after_ico, '')
    ORDER BY c.ico
    LIMIT _limit;

  SELECT count(*)::int, max(ico) INTO scn, last FROM _scan;
  IF scn = 0 THEN
    RETURN QUERY SELECT NULL::text, 0, 0;
    RETURN;
  END IF;

  WITH gone AS (
    UPDATE company_tax_status c
    SET is_current = false, valid_to = now(), removed_at = now()
    WHERE c.source_dataset = _dataset
      AND c.is_current
      AND c.ico IN (SELECT ico FROM _scan)
      AND NOT EXISTS (
        SELECT 1 FROM staging_tax_records s
        WHERE s.run_id = _run_id AND s.dataset = _dataset AND s.ico = c.ico
      )
    RETURNING 1
  ) SELECT count(*)::int INTO d FROM gone;

  DROP TABLE _scan;
  RETURN QUERY SELECT last, scn, d;
END $$;

CREATE OR REPLACE FUNCTION public.reconcile_tax_dataset_cleanup(_run_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM staging_tax_records WHERE run_id = _run_id;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_insurance_debts_batch(text, uuid, date, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_insurance_deactivate_batch(text, uuid, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_insurance_cleanup(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_tax_dataset_batch(text, uuid, date, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_tax_dataset_deactivate_batch(text, uuid, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_tax_dataset_cleanup(uuid) TO service_role;
