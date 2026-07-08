export type RiskLevel = "low" | "medium" | "high";

/**
 * Normalized shape returned by search endpoints. Not every field is
 * available for every result — name-based searches return only the light
 * fields the autocomplete endpoint exposes.
 */
export interface CompanySearchResult {
  name: string;
  ico: string;
  dic?: string;
  address?: string;
  legalForm?: string;
  riskScore?: number;
  revenue?: number;
  profit?: number;
  warningIndicators?: string[];
}


export interface Company {
  ico: string;
  dic?: string;
  icDph?: string;
  name: string;
  legalForm: string;
  address: string;
  city: string;
  registrationDate: string;
  vatPayer: boolean;
  revenue: number;
  profit: number;
  riskScore: number; // 0-100 (higher = healthier)
  riskLevel: RiskLevel;
  employees?: number;
  industry?: string;
  website?: string;
  aiSummary?: string;
  // Extended real Finstat fields
  registrationNumberText?: string;
  skNaceCode?: string;
  skNaceText?: string;
  latestAssets?: number;
  latestLiabilities?: number;
  warnings?: string[];
  paymentOrderWarnings?: string[];
  debtIndicators?: {
    taxDebt?: number;
    socialDebt?: number;
    healthDebt?: number;
    judicialDebt?: number;
  };
}

export interface FinancialYear {
  year: number;
  revenue: number;
  profit: number;
  ebitda: number;
  assets: number;
  liabilities: number;
}

export interface CompanyPerson {
  name: string;
  role: "executive" | "owner" | "beneficial_owner";
  since: string;
  share?: number; // ownership percentage
  address?: string;
}

export interface RiskIndicator {
  key:
    | "tax_debt"
    | "social_debt"
    | "health_debt"
    | "insolvency"
    | "executions"
    | "vat_reliability";
  label: string;
  status: "clear" | "warning" | "critical";
  detail: string;
  amount?: number;
}

export interface CompanyChange {
  date: string;
  type: string;
  description: string;
  severity: "info" | "warning" | "critical" | "success";
}

export interface MonitoringAlert {
  id: string;
  date: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "critical" | "success";
}

// Aliases matching the spec's naming.
export type CompanyFinancials = FinancialYear[];
export type CompanyRisk = RiskIndicator;

/** A single accounting statement (účtovná závierka) as filed in RÚZ. */
export interface AccountingStatement {
  id: string;
  year: number;
  /** Typ závierky — e.g. "Riadna", "Mimoriadna", "Priebežná". */
  type: string;
  /** Period start (YYYY-MM). */
  periodFrom?: string;
  /** Period end (YYYY-MM). */
  periodTo?: string;
  /** Date filed with RÚZ (YYYY-MM-DD). */
  submittedAt?: string;
  /** Date of preparation (YYYY-MM-DD). */
  preparedAt?: string;
  /** Date of approval (YYYY-MM-DD). */
  approvedAt?: string;
  consolidated?: boolean;
  /** Public link to the statement on registeruz.sk. */
  detailUrl?: string;
}


// Loose shape of a raw Finstat detail payload. Finstat returns many
// optional fields depending on plan/company; we only pin the ones we map.
export interface FinstatRawCompany {
  Ico?: string;
  Dic?: string;
  IcDph?: string;
  Name?: string;
  Street?: string;
  StreetNumber?: string;
  City?: string;
  ZipCode?: string;
  Region?: string;
  LegalForm?: string;
  Activity?: string;
  Created?: string; // ISO / dd.MM.yyyy
  Cancelled?: string;
  EmployeeCount?: string | number;
  Url?: string;
  SkNace?: { Code?: string; Name?: string } | null;
  Sales?: number;
  Profit?: number;
  Ebitda?: number;
  Assets?: number;
  Liabilities?: number;
  Warning?: string | null;
  WarningUrl?: string | null;
  Warnings?: Array<string | { Text?: string; Description?: string }> | null;
  PaymentOrder?: string | null;
  PaymentOrders?: Array<string | { Text?: string; Description?: string }> | null;
  PaymentOrderInfo?: { PaymentOrders?: Array<{ Text?: string; Description?: string }> } | null;
  RegisterNumberText?: string | null;
  TaxDebt?: number | null;
  JudicialDebt?: number | null;
  SocialInsuranceDebt?: number | null;
  HealthInsuranceDebt?: number | null;
  BankruptcyInfo?: unknown | null;
  DistrainmentsInfo?: { Distrainments?: unknown[] } | null;
  UnreliableVatPayer?: boolean | null;
  ReliableVatPayer?: boolean | null;
  Persons?: Array<{ Name?: string; Function?: string; From?: string }>;
  Owners?: Array<{ Name?: string; Share?: number; From?: string }>;
  KUVs?: Array<{ Name?: string; Share?: number; From?: string }>;
  Financials?: Array<{
    Year?: number;
    Sales?: number;
    Profit?: number;
    Ebitda?: number;
    Assets?: number;
    Liabilities?: number;
  }>;
  [key: string]: unknown;
}

export interface FinstatSearchHit {
  Ico?: string;
  Name?: string;
  Street?: string;
  City?: string;
  ZipCode?: string;
  Region?: string;
  [key: string]: unknown;
}
