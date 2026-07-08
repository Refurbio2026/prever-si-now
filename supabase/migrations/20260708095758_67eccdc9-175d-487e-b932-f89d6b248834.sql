
CREATE TABLE public.company_ai_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ico TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  overall_score INTEGER NOT NULL,
  financial_score INTEGER NOT NULL,
  growth_score INTEGER NOT NULL,
  public_score INTEGER NOT NULL,
  recommendation TEXT NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  weaknesses JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_ai_reports_ico ON public.company_ai_reports (ico);

GRANT SELECT ON public.company_ai_reports TO anon, authenticated;
GRANT ALL ON public.company_ai_reports TO service_role;

ALTER TABLE public.company_ai_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "AI reports are publicly readable"
  ON public.company_ai_reports
  FOR SELECT
  USING (true);

CREATE TRIGGER update_company_ai_reports_updated_at
  BEFORE UPDATE ON public.company_ai_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
