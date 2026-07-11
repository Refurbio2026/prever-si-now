
-- 1. Extend company_registry with RPO fields
ALTER TABLE public.company_registry
  ADD COLUMN IF NOT EXISTS name_normalized text,
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS psc text,
  ADD COLUMN IF NOT EXISTS obec text,
  ADD COLUMN IF NOT EXISTS obec_normalized text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS valid_from timestamptz,
  ADD COLUMN IF NOT EXISTS valid_to timestamptz,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_record_hash text;

-- 2. Search / lookup indexes
CREATE INDEX IF NOT EXISTS company_registry_ico_idx
  ON public.company_registry (ico);

CREATE INDEX IF NOT EXISTS company_registry_source_current_idx
  ON public.company_registry (source, is_current);

CREATE INDEX IF NOT EXISTS company_registry_name_trgm_idx
  ON public.company_registry USING gin (name_normalized gin_trgm_ops);

-- 3. Extend normalize_company_name with FULL written legal forms.
-- Runs BEFORE punctuation strip so multi-word phrases reduce correctly.
CREATE OR REPLACE FUNCTION public.normalize_company_name(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE s text;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  s := lower(public.unaccent('public.unaccent', input));
  -- Reduce full written legal forms first (case+diacritics already normalized).
  s := regexp_replace(s, 'spolocnost s rucenim obmedzenym', 'sro', 'g');
  s := regexp_replace(s, 'akciova spolocnost', 'as', 'g');
  s := regexp_replace(s, 'verejna obchodna spolocnost', 'vos', 'g');
  s := regexp_replace(s, 'komanditna spolocnost', 'ks', 'g');
  s := regexp_replace(s, 'statny podnik', 'sp', 'g');
  -- Strip punctuation and collapse whitespace.
  s := regexp_replace(s, '[^a-z0-9]+', ' ', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  s := btrim(s);
  IF s = '' THEN RETURN NULL; END IF;
  s := ' ' || s || ' ';
  s := regexp_replace(s, ' (spol s r o|s r o|s ro) ', ' sro ', 'g');
  s := regexp_replace(s, ' (a s) ', ' as ', 'g');
  s := regexp_replace(s, ' (v o s) ', ' vos ', 'g');
  s := regexp_replace(s, ' (k s) ', ' ks ', 'g');
  s := regexp_replace(s, ' (s p) ', ' sp ', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  RETURN btrim(s);
END $function$;

-- 4. Bulk close-removed helper for RPO registry (mirror of tax_debts one).
CREATE OR REPLACE FUNCTION public.close_removed_registry_keys(_source text, _icos text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE affected integer := 0;
BEGIN
  IF COALESCE(array_length(_icos, 1), 0) > 1000 THEN
    RAISE EXCEPTION 'too_many_keys';
  END IF;
  WITH changed AS (
    UPDATE public.company_registry
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
END $function$;

REVOKE ALL ON FUNCTION public.close_removed_registry_keys(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_removed_registry_keys(text, text[]) TO service_role;

-- 5. Grants for extended company_registry (idempotent — safe if already present)
GRANT SELECT ON public.company_registry TO anon, authenticated;
GRANT ALL ON public.company_registry TO service_role;
