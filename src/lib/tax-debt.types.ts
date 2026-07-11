// Client-safe types for the FS tax-debtors matching subsystem.

export type TaxDebtMatchTier = "exact" | "fuzzy" | "manual";

export interface MatchedTaxDebt {
  amount: number | null;
  sourceRecordDate: string | null;
  matchTier: TaxDebtMatchTier;
  matchConfidence: number | null;
  debtorNameRaw: string | null;
  debtorAddressRaw: string | null;
}

export interface UnmatchedCandidate {
  ico: string;
  nameNormalized: string;
  psc: string | null;
  obec: string | null;
  similarity: number;
}

export interface UnmatchedTaxDebtor {
  id: string;
  debtorNameRaw: string;
  addressRaw: string | null;
  psc: string | null;
  obec: string | null;
  amount: number | null;
  sourceRecordDate: string | null;
  candidates: UnmatchedCandidate[];
  status: "unmatched" | "manually_matched" | "ignored";
  matchedIco: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface TaxDebtMatchStats {
  totalRecords: number;
  matchedExact: number;
  matchedFuzzy: number;
  matchedManual: number;
  unmatched: number;
  sourceRecordDate: string | null;
  lastRunAt: string | null;
}
