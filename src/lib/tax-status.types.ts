// Client-safe shared types for the Financial Administration (FS SR) tax
// subsystem. Server-only fetchers live in
// `src/lib/providers/*-*.provider.server.ts`.

export const TAX_DATASETS = [
  "tax_debtors",
  "vat_registered",
  "tax_reliability",
] as const;
export type TaxDatasetId = (typeof TAX_DATASETS)[number];

export const TAX_DATASET_LABEL: Record<TaxDatasetId, string> = {
  tax_debtors: "Zoznam daňových dlžníkov",
  vat_registered: "Register platiteľov DPH",
  tax_reliability: "Index daňovej spoľahlivosti",
};

export const TAX_DATASET_SHORT: Record<TaxDatasetId, string> = {
  tax_debtors: "Dlžníci",
  vat_registered: "DPH",
  tax_reliability: "IDS",
};

// FS SR publishes debtor and VAT registers roughly quarterly; reliability
// index is updated less frequently. We treat "unverified" if our last
// successful import is older than 2× the refresh interval.
export const TAX_REFRESH_MS: Record<TaxDatasetId, number> = {
  tax_debtors: 90 * 24 * 60 * 60 * 1000,
  vat_registered: 24 * 60 * 60 * 1000,
  tax_reliability: 30 * 24 * 60 * 60 * 1000,
};

export const TAX_DATASET_LICENSE: Record<TaxDatasetId, string> = {
  tax_debtors:
    "Zdroj: Finančná správa SR — verejný zoznam daňových dlžníkov. Použité v súlade s podmienkami zverejnenia.",
  vat_registered:
    "Zdroj: Finančná správa SR — register platiteľov DPH.",
  tax_reliability:
    "Zdroj: Finančná správa SR — Index daňovej spoľahlivosti.",
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** One normalized record. `ico === null` means the row could not be
 *  matched to a company by IČO and MUST NOT be attached to a profile. */
export interface TaxStatusRecord {
  ico: string | null;
  dataset: TaxDatasetId;
  // Populated based on dataset:
  taxDebtorFound: boolean | null;
  taxDebtAmount: number | null;
  vatRegistered: boolean | null;
  icDph: string | null;
  vatRegistrationDate: string | null; // ISO YYYY-MM-DD
  taxReliabilityIndex: string | null;
  sourceRecordDate: string | null; // ISO YYYY-MM-DD
  sourceUrl: string;
  rawData: JsonValue;
}

export type TaxImportStatus =
  | "success"
  | "empty"
  | "unchanged"
  | "failed"
  | "not_implemented";

export interface TaxImporterOutcome {
  dataset: TaxDatasetId;
  status: TaxImportStatus;
  sourceUrl: string;
  recordsDownloaded: number;
  recordsNormalized: number;
  recordsWithValidIco: number;
  contentHash: string | null;
  errorMessage: string | null;
  records: TaxStatusRecord[];
  sourceRecordDate: string | null;
}

// UI-facing per-dataset state shown on the company profile.
export type CompanyTaxDebtorState =
  | { kind: "debt_found"; amount: number | null; recordDate: string | null }
  | { kind: "not_in_list"; recordDate: string | null }
  | { kind: "unverified"; reason: string }
  | { kind: "pending" };

export type CompanyVatState =
  | {
      kind: "registered";
      icDph: string | null;
      registrationDate: string | null;
      source: "financial_administration" | "finstat";
    }
  | { kind: "cancelled"; recordDate: string | null }
  | { kind: "unverified"; reason: string }
  | { kind: "unknown" };

export type CompanyReliabilityState =
  | { kind: "classified"; value: string; recordDate: string | null }
  | { kind: "unverified"; reason: string }
  | { kind: "not_classified" }
  | { kind: "pending" };

export interface CompanyTaxPayload {
  ico: string;
  debtor: {
    state: CompanyTaxDebtorState;
    sourceUrl: string | null;
    lastImportAt: string | null;
    lastSuccessAt: string | null;
    sourceRecordDate: string | null;
  };
  vat: {
    state: CompanyVatState;
    sourceUrl: string | null;
    lastImportAt: string | null;
    lastSuccessAt: string | null;
    sourceRecordDate: string | null;
  };
  reliability: {
    state: CompanyReliabilityState;
    sourceUrl: string | null;
    lastImportAt: string | null;
    lastSuccessAt: string | null;
    sourceRecordDate: string | null;
  };
}

/** Normalize a raw IČO string. Returns null when invalid. Preserves leading
 *  zeroes and rejects anything that is not 6–8 digits. */
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
