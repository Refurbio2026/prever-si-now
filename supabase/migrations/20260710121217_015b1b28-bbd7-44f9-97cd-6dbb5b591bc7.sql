
CREATE TABLE public.company_persons (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ico text NOT NULL,
  source text NOT NULL DEFAULT 'rpo',
  person_type text NOT NULL CHECK (person_type IN ('statutory_body','shareholder','founder','other')),
  function_label text,
  full_name text NOT NULL,
  address text,
  birth_date date,
  share_amount numeric,
  share_currency text,
  share_percent numeric,
  valid_from date,
  valid_to date,
  is_current boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX company_persons_unique_key
  ON public.company_persons (ico, person_type, full_name, COALESCE(function_label,''), COALESCE(valid_from, DATE '1900-01-01'));
CREATE INDEX company_persons_ico_current_idx ON public.company_persons (ico, is_current);

GRANT SELECT ON public.company_persons TO authenticated;
GRANT SELECT ON public.company_persons TO anon;
GRANT ALL ON public.company_persons TO service_role;

ALTER TABLE public.company_persons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_persons readable by everyone"
  ON public.company_persons FOR SELECT
  USING (true);

CREATE TRIGGER update_company_persons_updated_at
  BEFORE UPDATE ON public.company_persons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.company_registry_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ico text NOT NULL,
  source text NOT NULL DEFAULT 'rpo',
  change_type text NOT NULL CHECK (change_type IN (
    'name_changed','address_changed','legal_form_changed',
    'statutory_body_changed','shareholder_changed','other'
  )),
  field_label text,
  old_value text,
  new_value text,
  effective_date date,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX company_registry_history_unique_key
  ON public.company_registry_history (
    ico, change_type,
    COALESCE(field_label,''),
    COALESCE(old_value,''),
    COALESCE(new_value,''),
    COALESCE(effective_date, DATE '1900-01-01')
  );
CREATE INDEX company_registry_history_ico_date_idx
  ON public.company_registry_history (ico, effective_date DESC);

GRANT SELECT ON public.company_registry_history TO authenticated;
GRANT SELECT ON public.company_registry_history TO anon;
GRANT ALL ON public.company_registry_history TO service_role;

ALTER TABLE public.company_registry_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_registry_history readable by everyone"
  ON public.company_registry_history FOR SELECT
  USING (true);

CREATE TRIGGER update_company_registry_history_updated_at
  BEFORE UPDATE ON public.company_registry_history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
