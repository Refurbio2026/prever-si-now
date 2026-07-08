// Unified types for the multi-source Business Intelligence layer.
// The UI never sees which provider returned which field.

import type {
  AccountingStatement,
  Company,
  CompanyPerson,
  FinancialYear,
  RiskIndicator,
  UnifiedCompany,
} from "@/lib/types";

/** Registry (ORSR / RPO) detail bundle. Kept here so client code can render
 *  it without importing any `.server.ts` module. */
export interface RegistryDetails {
  source: ProviderSourceId;
  registrationNumber?: string;
  legalForm?: string;
  registeredAddress?: string;
  registrationDate?: string;
  status?: string;
  statutoryRepresentatives: CompanyPerson[];
}


export type ProviderSourceId =
  | "finstat"
  | "orsr"
  | "ruz"
  | "rpvs"
  | "financial_admin"
  | "social_insurance"
  | "health_insurance"
  | "crz"
  | "uvo"
  | "justice"
  | "enforcement"
  | "cadastre"
  | "ai"
  | "internal";

export type ProviderCapability =
  | "company"
  | "financials"
  | "statements"
  | "risks"
  | "people"
  | "contracts"
  | "monitoring";


export type ProviderState = "ok" | "unavailable" | "not_configured" | "empty" | "error";

export interface ProviderSourceStatus {
  source: ProviderSourceId;
  capability: ProviderCapability;
  state: ProviderState;
  message?: string;
  /** wall-clock ms the source took to answer */
  durationMs?: number;
}

export interface GovContract {
  id: string;
  title: string;
  counterparty: string;
  value?: number;
  currency?: string;
  signedAt?: string;
  source: "crz" | "uvo";
  url?: string;
}

export interface MonitoringSnapshot {
  isWatched: boolean;
  watchers: number;
  lastCheckedAt?: string;
  changeCount: number;
}

/** Development-mode diagnostics. Never populated in production builds. */
export interface ProviderDiagnostic {
  source: ProviderSourceId;
  capability: ProviderCapability;
  endpoint?: string;
  httpStatus?: number;
  rawError?: string;
  normalizedError?: string;
  errorCode?: string;
  finalUrlMasked?: string;
}

/** Full aggregated intelligence for a company. Every field is optional so the
 *  UI can render with partial data when some providers are unavailable. */
export interface CompanyIntelligence {
  ico: string;
  company?: Company;
  financials: FinancialYear[];
  statements: AccountingStatement[];
  people: CompanyPerson[];
  risks: RiskIndicator[];
  contracts: GovContract[];
  monitoring?: MonitoringSnapshot;
  /** Registry (ORSR) details — primary source for legal/registry fields. */
  registry?: RegistryDetails;
  sources: ProviderSourceStatus[];
  /** true if any source ended in `unavailable`/`error`/`not_configured` */
  partial: boolean;
  cachedAt: string;
  /** Per-field provenance map: which provider each displayed field came from. */
  fieldSources?: Record<string, ProviderSourceId>;
  /** Dev-mode only: detailed per-provider diagnostics. */
  diagnostics?: ProviderDiagnostic[];
  /** Dev-mode only: per-field merge audit (raw candidate values + decision). */
  /** Dev-mode only: per-field merge audit (raw candidate values + decision). */
  fieldAudit?: FieldMergeAudit[];
  /** Unified, provider-tagged view the UI reads from. */
  unified: UnifiedCompany;
}

/** Dev-mode audit entry: full merge trace for one field. */
export interface FieldMergeAudit {
  field: string;
  chosenSource: ProviderSourceId | null;
  chosenValue: string | number | boolean | null;
  decision: string;
  candidates: Array<{ source: ProviderSourceId; value: string | number | boolean | null }>;
}


