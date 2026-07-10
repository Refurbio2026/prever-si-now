// Client-safe shared types for the insurance-debt subsystem.
// Server-only fetchers live in `src/lib/providers/*-debt.provider.server.ts`.

export const INSURANCE_PROVIDERS = [
  "social_insurance",
  "vszp",
  "dovera",
  "union",
] as const;
export type InsuranceProviderId = (typeof INSURANCE_PROVIDERS)[number];

export const INSURANCE_PROVIDER_LABEL: Record<InsuranceProviderId, string> = {
  social_insurance: "Sociálna poisťovňa",
  vszp: "Všeobecná zdravotná poisťovňa (VšZP)",
  dovera: "Dôvera zdravotná poisťovňa",
  union: "Union zdravotná poisťovňa",
};

export const INSURANCE_PROVIDER_SHORT: Record<InsuranceProviderId, string> = {
  social_insurance: "SP",
  vszp: "VšZP",
  dovera: "Dôvera",
  union: "Union",
};

export const INSURANCE_REFRESH_MS: Record<InsuranceProviderId, number> = {
  social_insurance: 7 * 24 * 60 * 60 * 1000,
  vszp: 24 * 60 * 60 * 1000,
  dovera: 24 * 60 * 60 * 1000,
  union: 24 * 60 * 60 * 1000,
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** One normalized debtor record. `ico === null` means the record could not
 *  be matched to a company by IČO and must not be attached to a profile. */
export interface InsuranceDebtRecord {
  ico: string | null;
  provider: InsuranceProviderId;
  debtorFound: boolean;
  debtAmount: number | null;
  currency: "EUR";
  debtorName: string | null;
  address: string | null;
  sourceRecordDate: string | null;
  sourceUrl: string;
  rawData: JsonValue;
}

export type ImportRunStatus =
  | "success"
  | "empty"
  | "unchanged"
  | "failed"
  | "not_implemented";

export interface ImporterOutcome {
  provider: InsuranceProviderId;
  status: ImportRunStatus;
  sourceUrl: string;
  recordsDownloaded: number;
  recordsNormalized: number;
  recordsWithIco: number;
  contentHash: string | null;
  errorMessage: string | null;
  records: InsuranceDebtRecord[];
  /** ISO date extracted from the source dataset (e.g. week number → date). */
  sourceRecordDate: string | null;
}

/** UI-facing per-provider status shown on the company profile. */
export type CompanyInsuranceState =
  | { kind: "debt_found"; amount: number | null; recordDate: string | null }
  | { kind: "not_in_list" }
  | { kind: "unverified"; reason: string }
  | { kind: "pending" };

export interface CompanyInsuranceRow {
  provider: InsuranceProviderId;
  label: string;
  state: CompanyInsuranceState;
  debtorName: string | null;
  address: string | null;
  sourceUrl: string | null;
  lastImportAt: string | null;
  lastSuccessAt: string | null;
}

/** Normalize a raw IČO string. Returns null when invalid. Preserves leading
 *  zeroes and rejects anything that is not 6–8 digits. Slovak IČO is 8
 *  digits, but some older records store 6 digits — we left-pad to 8. */
export function normalizeIco(input: string | null | undefined): string | null {
  if (input == null) return null;
  const digits = String(input).replace(/\D+/g, "");
  if (digits.length < 6 || digits.length > 8) return null;
  return digits.padStart(8, "0");
}

/** Parse Slovak-formatted decimal ("1 234,56" or "1234.56") to a number. */
export function parseSkAmount(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = String(input)
    .replace(/\s|\u00A0/g, "")
    .replace(/€/g, "")
    .trim();
  if (!cleaned) return null;
  const withDot = cleaned.replace(/\./g, "").replace(",", ".");
  const n = Number(withDot);
  return Number.isFinite(n) ? n : null;
}
