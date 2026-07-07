export type RiskLevel = "low" | "medium" | "high";

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
