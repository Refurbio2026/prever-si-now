CREATE TABLE public.data_freshness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ico text NOT NULL,
  source text NOT NULL,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  status text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ico, source)
);

CREATE INDEX idx_data_freshness_ico ON public.data_freshness(ico);
CREATE INDEX idx_data_freshness_source_success ON public.data_freshness(source, last_success_at);

GRANT SELECT ON public.data_freshness TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_freshness TO authenticated;
GRANT ALL ON public.data_freshness TO service_role;

ALTER TABLE public.data_freshness ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read data freshness"
  ON public.data_freshness FOR SELECT USING (true);

CREATE POLICY "Admins can manage data freshness"
  ON public.data_freshness FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER data_freshness_set_updated_at
  BEFORE UPDATE ON public.data_freshness
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();