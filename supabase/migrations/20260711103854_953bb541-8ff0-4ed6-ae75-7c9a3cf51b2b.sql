
REVOKE EXECUTE ON FUNCTION public.close_removed_tax_debt_keys(text, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_removed_tax_debt_keys(text, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.close_removed_tax_debt_keys(text, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.close_removed_tax_debt_keys(text, text[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.find_tax_debtor_candidates(text, text, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_tax_debtor_candidates(text, text, text, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.find_tax_debtor_candidates(text, text, text, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_tax_debtor_candidates(text, text, text, int) TO service_role;
