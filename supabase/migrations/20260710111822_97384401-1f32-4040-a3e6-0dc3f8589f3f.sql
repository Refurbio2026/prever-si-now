
CREATE TABLE IF NOT EXISTS public.company_tax_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ico text NOT NULL,
  tax_debtor_found boolean NULL,
  tax_debt_amount numeric NULL,
  vat_registered boolean NULL,
  ic_dph text NULL,
  vat_registration_date date NULL,
  tax_reliability_index text NULL,
  source_record_date date NULL,
  source_url text NULL,
  source_dataset text NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  raw_data jsonb NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS company_tax_status_ico_dataset_date_uidx
  ON public.company_tax_status (ico, source_dataset, source_record_date);
CREATE INDEX IF NOT EXISTS company_tax_status_ico_idx
  ON public.company_tax_status (ico);

GRANT SELECT ON public.company_tax_status TO anon, authenticated;
GRANT ALL ON public.company_tax_status TO service_role;

ALTER TABLE public.company_tax_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read tax status"
  ON public.company_tax_status FOR SELECT
  USING (true);


CREATE TABLE IF NOT EXISTS public.tax_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset text NOT NULL,
  status text NOT NULL,
  source_url text NULL,
  content_hash text NULL,
  source_record_date date NULL,
  records_downloaded integer NOT NULL DEFAULT 0,
  records_normalized integer NOT NULL DEFAULT 0,
  records_with_valid_ico integer NOT NULL DEFAULT 0,
  error_message text NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS tax_import_runs_dataset_started_idx
  ON public.tax_import_runs (dataset, started_at DESC);

GRANT SELECT ON public.tax_import_runs TO authenticated;
GRANT ALL ON public.tax_import_runs TO service_role;

ALTER TABLE public.tax_import_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read tax import runs"
  ON public.tax_import_runs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
