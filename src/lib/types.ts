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
