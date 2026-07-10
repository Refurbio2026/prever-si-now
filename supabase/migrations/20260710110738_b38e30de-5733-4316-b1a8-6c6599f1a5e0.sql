
-- Insurance debt records (per company, per provider, per source snapshot date)
CREATE TABLE public.company_insurance_debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ico TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('social_insurance','vszp','dovera','union')),
  debtor_found BOOLEAN NOT NULL,
  debt_amount NUMERIC NULL,
  currency TEXT DEFAULT 'EUR',
  debtor_name TEXT NULL,
  address TEXT NULL,
  source_record_date DATE NULL,
  source_url TEXT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_data JSONB NULL,
  CONSTRAINT company_insurance_debts_unique UNIQUE (ico, provider, source_record_date)
);
CREATE INDEX company_insurance_debts_ico_idx ON public.company_insurance_debts (ico);
CREATE INDEX company_insurance_debts_provider_idx ON public.company_insurance_debts (provider, imported_at DESC);

GRANT SELECT ON public.company_insurance_debts TO anon, authenticated;
GRANT ALL ON public.company_insurance_debts TO service_role;
ALTER TABLE public.company_insurance_debts ENABLE ROW LEVEL SECURITY;
-- Debtor lists are public information already published by the insurers.
CREATE POLICY "Public read insurance debts" ON public.company_insurance_debts FOR SELECT USING (true);

-- Per-provider import run history
CREATE TABLE public.insurance_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  records_downloaded INTEGER DEFAULT 0,
  records_normalized INTEGER DEFAULT 0,
  records_with_ico INTEGER DEFAULT 0,
  content_hash TEXT NULL,
  source_url TEXT NULL,
  error_message TEXT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL
);
CREATE INDEX insurance_import_runs_provider_started_idx ON public.insurance_import_runs (provider, started_at DESC);

GRANT SELECT ON public.insurance_import_runs TO authenticated;
GRANT ALL ON public.insurance_import_runs TO service_role;
ALTER TABLE public.insurance_import_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view insurance import runs" ON public.insurance_import_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
