
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Normalization helpers ----------

CREATE OR REPLACE FUNCTION public.normalize_company_name(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE s text;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  s := lower(public.unaccent('public.unaccent', input));
  -- Strip punctuation early, collapse whitespace.
  s := regexp_replace(s, '[^a-z0-9]+', ' ', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  s := btrim(s);
  IF s = '' THEN RETURN NULL; END IF;
  -- Pad so token replacements match at word boundaries.
  s := ' ' || s || ' ';
  s := regexp_replace(s, ' (spol s r o|s r o|s ro) ', ' sro ', 'g');
  s := regexp_replace(s, ' (akciova spolocnost|a s) ', ' as ', 'g');
  s := regexp_replace(s, ' (verejna obchodna spolocnost|v o s) ', ' vos ', 'g');
  s := regexp_replace(s, ' (komanditna spolocnost|k s) ', ' ks ', 'g');
  s := regexp_replace(s, ' (statny podnik|s p) ', ' sp ', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  RETURN btrim(s);
END $$;

CREATE OR REPLACE FUNCTION public.normalize_text(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE s text;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  s := lower(public.unaccent('public.unaccent', input));
  s := regexp_replace(s, '[^a-z0-9]+', ' ', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  s := btrim(s);
  IF s = '' THEN RETURN NULL; END IF;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.extract_psc(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE m text;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  m := (regexp_match(input, '(\d{3}\s?\d{2})'))[1];
  IF m IS NULL THEN RETURN NULL; END IF;
  RETURN regexp_replace(m, '\s', '', 'g');
END $$;

CREATE OR REPLACE FUNCTION public.extract_obec(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE tail text;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  -- Take substring after a PSČ if present, otherwise use whole address.
  tail := (regexp_match(input, '\d{3}\s?\d{2}\s*[,\-]?\s*(.+)$'))[1];
  IF tail IS NULL THEN tail := input; END IF;
  RETURN public.normalize_text(tail);
END $$;

-- ---------- company_match_keys ----------

CREATE TABLE IF NOT EXISTS public.company_match_keys (
  ico text PRIMARY KEY,
  name_normalized text,
  psc text,
  obec text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.company_match_keys TO authenticated;
GRANT ALL ON public.company_match_keys TO service_role;

ALTER TABLE public.company_match_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read match keys"
  ON public.company_match_keys FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS company_match_keys_name_trgm
  ON public.company_match_keys USING gin (name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS company_match_keys_psc
  ON public.company_match_keys (psc);
CREATE INDEX IF NOT EXISTS company_match_keys_obec
  ON public.company_match_keys (obec);

-- Backfill from company_registry.
INSERT INTO public.company_match_keys (ico, name_normalized, psc, obec)
SELECT
  ico,
  public.normalize_company_name(name),
  public.extract_psc(address),
  public.extract_obec(address)
FROM public.company_registry
ON CONFLICT (ico) DO UPDATE
  SET name_normalized = EXCLUDED.name_normalized,
      psc = EXCLUDED.psc,
      obec = EXCLUDED.obec,
      updated_at = now();

-- Trigger: keep in sync when company_registry changes.
CREATE OR REPLACE FUNCTION public.sync_company_match_keys()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.company_match_keys (ico, name_normalized, psc, obec, updated_at)
  VALUES (
    NEW.ico,
    public.normalize_company_name(NEW.name),
    public.extract_psc(NEW.address),
    public.extract_obec(NEW.address),
    now()
  )
  ON CONFLICT (ico) DO UPDATE
    SET name_normalized = EXCLUDED.name_normalized,
        psc = EXCLUDED.psc,
        obec = EXCLUDED.obec,
        updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_company_match_keys_trg ON public.company_registry;
CREATE TRIGGER sync_company_match_keys_trg
  AFTER INSERT OR UPDATE OF name, address ON public.company_registry
  FOR EACH ROW EXECUTE FUNCTION public.sync_company_match_keys();

-- ---------- company_tax_debts (matched debtor records) ----------

CREATE TABLE IF NOT EXISTS public.company_tax_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ico text NOT NULL,
  source text NOT NULL DEFAULT 'fs_tax_debtors',
  debtor_name_raw text,
  debtor_address_raw text,
  amount numeric,
  source_record_date date,
  match_tier text NOT NULL CHECK (match_tier IN ('exact','fuzzy','manual')),
  match_confidence numeric,
  source_record_hash text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  is_current boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ico, source, valid_from)
);

GRANT SELECT ON public.company_tax_debts TO authenticated;
GRANT SELECT ON public.company_tax_debts TO anon;
GRANT ALL ON public.company_tax_debts TO service_role;

ALTER TABLE public.company_tax_debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read matched tax debts"
  ON public.company_tax_debts FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS company_tax_debts_ico_current
  ON public.company_tax_debts (ico, source) WHERE is_current;
CREATE INDEX IF NOT EXISTS company_tax_debts_source_current
  ON public.company_tax_debts (source, is_current);

-- ---------- tax_debtor_unmatched ----------

CREATE TABLE IF NOT EXISTS public.tax_debtor_unmatched (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid,
  debtor_name_raw text NOT NULL,
  debtor_name_normalized text,
  address_raw text,
  psc text,
  obec text,
  amount numeric,
  source_record_date date,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','manually_matched','ignored')),
  matched_ico text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (debtor_name_normalized, psc, source_record_date)
);

GRANT SELECT, INSERT, UPDATE ON public.tax_debtor_unmatched TO authenticated;
GRANT ALL ON public.tax_debtor_unmatched TO service_role;

ALTER TABLE public.tax_debtor_unmatched ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage unmatched"
  ON public.tax_debtor_unmatched FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS tax_debtor_unmatched_status
  ON public.tax_debtor_unmatched (status, created_at DESC);
CREATE INDEX IF NOT EXISTS tax_debtor_unmatched_name_trgm
  ON public.tax_debtor_unmatched USING gin (debtor_name_normalized gin_trgm_ops);

-- ---------- tax_debtor_manual_mappings ----------

CREATE TABLE IF NOT EXISTS public.tax_debtor_manual_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_normalized text NOT NULL,
  psc text NOT NULL,
  ico text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name_normalized, psc)
);

GRANT SELECT, INSERT, DELETE ON public.tax_debtor_manual_mappings TO authenticated;
GRANT ALL ON public.tax_debtor_manual_mappings TO service_role;

ALTER TABLE public.tax_debtor_manual_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage manual mappings"
  ON public.tax_debtor_manual_mappings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------- Match RPCs ----------

CREATE OR REPLACE FUNCTION public.find_tax_debtor_candidates(
  _name_normalized text,
  _psc text,
  _obec text,
  _limit int DEFAULT 3
)
RETURNS TABLE(ico text, name_normalized text, psc text, obec text, sim real)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT k.ico, k.name_normalized, k.psc, k.obec,
         similarity(k.name_normalized, _name_normalized) AS sim
  FROM public.company_match_keys k
  WHERE k.name_normalized IS NOT NULL
    AND ( (_psc IS NOT NULL AND k.psc = _psc)
          OR (_obec IS NOT NULL AND k.obec = _obec)
          OR k.name_normalized % _name_normalized )
    AND similarity(k.name_normalized, _name_normalized) > 0.5
  ORDER BY sim DESC
  LIMIT _limit
$$;

CREATE OR REPLACE FUNCTION public.close_removed_tax_debt_keys(
  _source text,
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
    UPDATE public.company_tax_debts
    SET is_current = false,
        valid_to = now(),
        removed_at = now(),
        updated_at = now()
    WHERE source = _source
      AND is_current = true
      AND ico = ANY(_icos)
    RETURNING 1
  )
  SELECT count(*)::integer INTO affected FROM changed;
  RETURN affected;
END $$;

-- Trigger to bump updated_at on company_tax_debts.
CREATE TRIGGER company_tax_debts_touch
  BEFORE UPDATE ON public.company_tax_debts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER tax_debtor_unmatched_touch
  BEFORE UPDATE ON public.tax_debtor_unmatched
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
