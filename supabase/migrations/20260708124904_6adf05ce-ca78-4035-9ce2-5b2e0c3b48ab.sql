
CREATE TABLE public.company_people (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ico TEXT NOT NULL,
  person_name TEXT NOT NULL,
  role TEXT NOT NULL,
  valid_from DATE,
  valid_to DATE,
  source TEXT NOT NULL DEFAULT 'ORSR',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX company_people_ico_idx ON public.company_people(ico);
CREATE UNIQUE INDEX company_people_unique ON public.company_people(ico, person_name, role, COALESCE(valid_from, DATE '1900-01-01'));

GRANT SELECT ON public.company_people TO anon, authenticated;
GRANT ALL ON public.company_people TO service_role;

ALTER TABLE public.company_people ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company people are publicly readable"
  ON public.company_people FOR SELECT
  USING (true);

CREATE TRIGGER update_company_people_updated_at
  BEFORE UPDATE ON public.company_people
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.company_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ico TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  event_date DATE,
  source TEXT NOT NULL DEFAULT 'ORSR',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX company_history_ico_idx ON public.company_history(ico);
CREATE INDEX company_history_ico_date_idx ON public.company_history(ico, event_date DESC);
CREATE UNIQUE INDEX company_history_unique ON public.company_history(ico, event_type, title, COALESCE(event_date, DATE '1900-01-01'));

GRANT SELECT ON public.company_history TO anon, authenticated;
GRANT ALL ON public.company_history TO service_role;

ALTER TABLE public.company_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company history is publicly readable"
  ON public.company_history FOR SELECT
  USING (true);

CREATE TRIGGER update_company_history_updated_at
  BEFORE UPDATE ON public.company_history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
