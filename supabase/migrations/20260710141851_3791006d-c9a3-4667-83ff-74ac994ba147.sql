CREATE INDEX IF NOT EXISTS staging_insurance_debts_run_provider_ico_idx
  ON public.staging_insurance_debts (run_id, provider, ico);

CREATE INDEX IF NOT EXISTS staging_tax_records_run_dataset_ico_idx
  ON public.staging_tax_records (run_id, dataset, ico);