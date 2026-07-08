// Unified types for the multi-source Business Intelligence layer.
// The UI never sees which provider returned which field.

import type {
  AccountingStatement,
  Company,
  CompanyPerson,
  FinancialYear,
  RiskIndicator,
} from "@/lib/types";
import type { OrsrRegistryDetails } from "./orsr.provider.server";


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
  sources: ProviderSourceStatus[];
  /** true if any source ended in `unavailable`/`error`/`not_configured` */
  partial: boolean;
  cachedAt: string;
  /** Dev-mode only: detailed per-provider diagnostics. */
  diagnostics?: ProviderDiagnostic[];
}


