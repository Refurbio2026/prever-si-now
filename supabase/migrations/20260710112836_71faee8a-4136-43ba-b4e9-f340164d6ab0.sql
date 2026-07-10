
-- ============ Insurance table: lifecycle columns ============
ALTER TABLE public.company_insurance_debts
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_to timestamptz NULL,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS source_import_run_id uuid NULL,
  ADD COLUMN IF NOT EXISTS source_record_hash text NULL;

-- Backfill: keep only the newest row per (ico,provider) as current.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY ico, provider ORDER BY imported_at DESC, id DESC) AS rn
  FROM public.company_insurance_debts
)
UPDATE public.company_insurance_debts c
SET is_current = false, valid_to = now()
FROM ranked r
WHERE c.id = r.id AND r.rn > 1;

-- Drop any prior unique constraint / index on the insurance table
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.company_insurance_debts'::regclass AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.company_insurance_debts DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS company_insurance_debts_current_uidx
  ON public.company_insurance_debts (ico, provider) WHERE is_current;
CREATE INDEX IF NOT EXISTS company_insurance_debts_provider_current_idx
  ON public.company_insurance_debts (provider, is_current);

-- ============ Tax table: lifecycle columns ============
ALTER TABLE public.company_tax_status
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_to timestamptz NULL,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS source_import_run_id uuid NULL,
  ADD COLUMN IF NOT EXISTS source_record_hash text NULL;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY ico, source_dataset ORDER BY imported_at DESC, id DESC) AS rn
  FROM public.company_tax_status
)
UPDATE public.company_tax_status c
SET is_current = false, valid_to = now()
FROM ranked r
WHERE c.id = r.id AND r.rn > 1;

DROP INDEX IF EXISTS public.company_tax_status_ico_dataset_date_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS company_tax_status_current_uidx
  ON public.company_tax_status (ico, source_dataset) WHERE is_current;
CREATE INDEX IF NOT EXISTS company_tax_status_dataset_current_idx
  ON public.company_tax_status (source_dataset, is_current);

-- ============ Run tables: reconciliation counters ============
ALTER TABLE public.insurance_import_runs
  ADD COLUMN IF NOT EXISTS previous_source_hash text NULL,
  ADD COLUMN IF NOT EXISTS records_valid integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_invalid integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_inserted integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_updated integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_unchanged integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_deactivated integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validation_status text NULL,
  ADD COLUMN IF NOT EXISTS source_record_date date NULL;

ALTER TABLE public.tax_import_runs
  ADD COLUMN IF NOT EXISTS previous_source_hash text NULL,
  ADD COLUMN IF NOT EXISTS records_valid integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_invalid integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_inserted integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_updated integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_unchanged integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_deactivated integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validation_status text NULL;

-- ============ Staging tables (backend only) ============
CREATE TABLE IF NOT EXISTS public.staging_insurance_debts (
  ico text NOT NULL,
  provider text NOT NULL,
  debt_amount numeric NULL,
  currency text NULL,
  debtor_name text NULL,
  address text NULL,
  source_url text NULL,
  raw_data jsonb NULL,
  source_record_hash text NOT NULL,
  run_id uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS staging_insurance_debts_run_idx
  ON public.staging_insurance_debts (run_id, provider);
CREATE INDEX IF NOT EXISTS staging_insurance_debts_lookup_idx
  ON public.staging_insurance_debts (provider, ico);
GRANT ALL ON public.staging_insurance_debts TO service_role;
ALTER TABLE public.staging_insurance_debts ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies. Only service_role reaches this table.

CREATE TABLE IF NOT EXISTS public.staging_tax_records (
  ico text NOT NULL,
  dataset text NOT NULL,
  tax_debtor_found boolean NULL,
  tax_debt_amount numeric NULL,
  vat_registered boolean NULL,
  ic_dph text NULL,
  vat_registration_date date NULL,
  tax_reliability_index text NULL,
  source_url text NULL,
  raw_data jsonb NULL,
  source_record_hash text NOT NULL,
  run_id uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS staging_tax_records_run_idx
  ON public.staging_tax_records (run_id, dataset);
CREATE INDEX IF NOT EXISTS staging_tax_records_lookup_idx
  ON public.staging_tax_records (dataset, ico);
GRANT ALL ON public.staging_tax_records TO service_role;
ALTER TABLE public.staging_tax_records ENABLE ROW LEVEL SECURITY;

-- ============ Reconciliation function: insurance ============
CREATE OR REPLACE FUNCTION public.reconcile_insurance_debts(
  _provider text,
  _run_id uuid,
  _source_date date
) RETURNS TABLE(inserted int, updated int, unchanged int, deactivated int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE ins int := 0; upd int := 0; unc int := 0; deac int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('reconcile_insurance:' || _provider)) THEN
    RAISE EXCEPTION 'Reconciliation already running for provider %', _provider;
  END IF;

  WITH new_rows AS (
    INSERT INTO company_insurance_debts (
      ico, provider, debtor_found, debt_amount, currency, debtor_name, address,
      source_record_date, source_url, raw_data, source_record_hash,
      source_import_run_id, is_current, first_seen_at, last_seen_at, valid_from
    )
    SELECT s.ico, s.provider, true, s.debt_amount, COALESCE(s.currency,'EUR'),
           s.debtor_name, s.address, _source_date, s.source_url, s.raw_data,
           s.source_record_hash, _run_id, true, now(), now(), now()
    FROM staging_insurance_debts s
    WHERE s.run_id = _run_id AND s.provider = _provider
      AND NOT EXISTS (
        SELECT 1 FROM company_insurance_debts c
        WHERE c.ico = s.ico AND c.provider = _provider AND c.is_current
      )
    RETURNING 1
  ) SELECT count(*) INTO ins FROM new_rows;

  WITH same AS (
    UPDATE company_insurance_debts c
    SET last_seen_at = now(),
        imported_at = now(),
        source_import_run_id = _run_id
    FROM staging_insurance_debts s
    WHERE s.run_id = _run_id AND s.provider = _provider
      AND c.ico = s.ico AND c.provider = s.provider AND c.is_current
      AND c.source_record_hash IS NOT DISTINCT FROM s.source_record_hash
    RETURNING 1
  ) SELECT count(*) INTO unc FROM same;

  WITH changed_pairs AS (
    SELECT s.ico, s.provider, s.debt_amount, s.currency, s.debtor_name,
           s.address, s.source_url, s.raw_data, s.source_record_hash
    FROM staging_insurance_debts s
    JOIN company_insurance_debts c
      ON c.ico = s.ico AND c.provider = s.provider AND c.is_current
    WHERE s.run_id = _run_id AND s.provider = _provider
      AND c.source_record_hash IS DISTINCT FROM s.source_record_hash
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
  SELECT (SELECT count(*) FROM closed), (SELECT count(*) FROM inserted_new) INTO upd, upd;
  -- (upd assignment repeated so both CTEs execute)

  WITH gone AS (
    UPDATE company_insurance_debts c
    SET is_current = false, valid_to = now(), removed_at = now()
    WHERE c.provider = _provider AND c.is_current
      AND NOT EXISTS (
        SELECT 1 FROM staging_insurance_debts s
        WHERE s.run_id = _run_id AND s.provider = _provider AND s.ico = c.ico
      )
    RETURNING 1
  ) SELECT count(*) INTO deac FROM gone;

  DELETE FROM staging_insurance_debts WHERE run_id = _run_id;
  RETURN QUERY SELECT ins, upd, unc, deac;
END $$;

REVOKE ALL ON FUNCTION public.reconcile_insurance_debts(text, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_insurance_debts(text, uuid, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_insurance_debts(text, uuid, date) TO service_role;

-- ============ Reconciliation function: tax ============
CREATE OR REPLACE FUNCTION public.reconcile_tax_dataset(
  _dataset text,
  _run_id uuid,
  _source_date date
) RETURNS TABLE(inserted int, updated int, unchanged int, deactivated int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE ins int := 0; upd int := 0; unc int := 0; deac int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('reconcile_tax:' || _dataset)) THEN
    RAISE EXCEPTION 'Reconciliation already running for dataset %', _dataset;
  END IF;

  WITH new_rows AS (
    INSERT INTO company_tax_status (
      ico, source_dataset, tax_debtor_found, tax_debt_amount, vat_registered, ic_dph,
      vat_registration_date, tax_reliability_index, source_record_date, source_url,
      raw_data, source_record_hash, source_import_run_id, is_current,
      first_seen_at, last_seen_at, valid_from
    )
    SELECT s.ico, s.dataset, s.tax_debtor_found, s.tax_debt_amount, s.vat_registered,
           s.ic_dph, s.vat_registration_date, s.tax_reliability_index, _source_date,
           s.source_url, s.raw_data, s.source_record_hash, _run_id, true,
           now(), now(), now()
    FROM staging_tax_records s
    WHERE s.run_id = _run_id AND s.dataset = _dataset
      AND NOT EXISTS (
        SELECT 1 FROM company_tax_status c
        WHERE c.ico = s.ico AND c.source_dataset = _dataset AND c.is_current
      )
    RETURNING 1
  ) SELECT count(*) INTO ins FROM new_rows;

  WITH same AS (
    UPDATE company_tax_status c
    SET last_seen_at = now(), imported_at = now(), source_import_run_id = _run_id
    FROM staging_tax_records s
    WHERE s.run_id = _run_id AND s.dataset = _dataset
      AND c.ico = s.ico AND c.source_dataset = s.dataset AND c.is_current
      AND c.source_record_hash IS NOT DISTINCT FROM s.source_record_hash
    RETURNING 1
  ) SELECT count(*) INTO unc FROM same;

  WITH changed_pairs AS (
    SELECT s.ico, s.dataset, s.tax_debtor_found, s.tax_debt_amount, s.vat_registered,
           s.ic_dph, s.vat_registration_date, s.tax_reliability_index,
           s.source_url, s.raw_data, s.source_record_hash
    FROM staging_tax_records s
    JOIN company_tax_status c
      ON c.ico = s.ico AND c.source_dataset = s.dataset AND c.is_current
    WHERE s.run_id = _run_id AND s.dataset = _dataset
      AND c.source_record_hash IS DISTINCT FROM s.source_record_hash
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
  SELECT (SELECT count(*) FROM closed), (SELECT count(*) FROM inserted_new) INTO upd, upd;

  WITH gone AS (
    UPDATE company_tax_status c
    SET is_current = false, valid_to = now(), removed_at = now()
    WHERE c.source_dataset = _dataset AND c.is_current
      AND NOT EXISTS (
        SELECT 1 FROM staging_tax_records s
        WHERE s.run_id = _run_id AND s.dataset = _dataset AND s.ico = c.ico
      )
    RETURNING 1
  ) SELECT count(*) INTO deac FROM gone;

  DELETE FROM staging_tax_records WHERE run_id = _run_id;
  RETURN QUERY SELECT ins, upd, unc, deac;
END $$;

REVOKE ALL ON FUNCTION public.reconcile_tax_dataset(text, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_tax_dataset(text, uuid, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_tax_dataset(text, uuid, date) TO service_role;
