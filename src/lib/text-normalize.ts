// Shared normalization utilities used on BOTH sides of tax-debtor matching.
// The Postgres functions `normalize_company_name`, `normalize_text`,
// `extract_psc`, `extract_obec` mirror this exactly — keep them in sync.

function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Normalize a company name: lowercase + unaccent + unified legal forms. */
export function normalizeCompanyName(input: string | null | undefined): string | null {
  if (input == null) return null;
  let s = stripDiacritics(String(input)).toLowerCase();
  s = s
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  s = ` ${s} `;
  s = s.replace(/ (spol s r o|s r o|s ro) /g, " sro ");
  s = s.replace(/ (akciova spolocnost|a s) /g, " as ");
  s = s.replace(/ (verejna obchodna spolocnost|v o s) /g, " vos ");
  s = s.replace(/ (komanditna spolocnost|k s) /g, " ks ");
  s = s.replace(/ (statny podnik|s p) /g, " sp ");
  return s.replace(/\s+/g, " ").trim();
}

/** Normalize free-form text: lowercase + unaccent + punctuation stripped. */
export function normalizeText(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = stripDiacritics(String(input))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
}

/** Extract Slovak PSČ (5 digits, may be formatted "811 01"). */
export function extractPsc(input: string | null | undefined): string | null {
  if (input == null) return null;
  const m = String(input).match(/(\d{3}\s?\d{2})/);
  if (!m) return null;
  return m[1].replace(/\s/g, "");
}

/** Extract city (obec) — text after PSČ, normalized. */
export function extractObec(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = String(input);
  const m = s.match(/\d{3}\s?\d{2}\s*[,\-]?\s*(.+)$/);
  return normalizeText(m ? m[1] : s);
}
