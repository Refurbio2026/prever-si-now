// Domain providers — each aggregates one capability across all upstream
// sources. Adding a Czech provider later means adding one file and one line
// to the relevant provider below; the UI needs zero changes.

import type { Company, CompanyPerson, FinancialYear, RiskIndicator } from "@/lib/types";
import type {
  FieldMergeAudit,
  GovContract,
  MonitoringSnapshot,
  ProviderDiagnostic,
  ProviderSourceId,
  ProviderSourceStatus,
  RegistryDetails,
} from "./types";

import { finstatFetchAll } from "./finstat.provider.server";
import { orsrRegistryDetails } from "./orsr.provider.server";
import {
  crzContracts,
  financialAdminRisks,
  healthInsuranceRisks,
  justiceRisks,
  rpvsBeneficialOwners,
  ruzFinancials,
  socialInsuranceRisks,
  uvoContracts,
  enforcementRisks,
  aiRiskAnalysis,
  cadastreCompanyInfo,
} from "./registry.server";
import { internalMonitoring } from "./monitoring.provider.server";

interface FinstatBundle {
  company: Awaited<ReturnType<typeof finstatFetchAll>>["company"];
  financials: Awaited<ReturnType<typeof finstatFetchAll>>["financials"];
  people: Awaited<ReturnType<typeof finstatFetchAll>>["people"];
  risks: Awaited<ReturnType<typeof finstatFetchAll>>["risks"];
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function runCompanyProvider(
  ico: string,
  finstat: FinstatBundle,
  diagnostics?: ProviderDiagnostic[],
): Promise<{
  data: Company | undefined;
  registry?: RegistryDetails;
  sources: ProviderSourceStatus[];
}> {
  const orsr = await safe(orsrRegistryDetails(ico, diagnostics), {
    data: undefined as import("./orsr.provider.server").OrsrRegistryDetails | undefined,
    status: { source: "orsr" as const, capability: "company" as const, state: "error" as const },
  });
  const cadastre = await safe(cadastreCompanyInfo(ico), {
    data: undefined,
    status: { source: "cadastre" as const, capability: "company" as const, state: "error" as const },
  });

  // ORSR is the primary source for registry/legal fields; Finstat is fallback.
  const base = finstat.company.data;
  let merged: Company | undefined = base;
  if (base && orsr.data) {
    merged = {
      ...base,
      legalForm: orsr.data.legalForm || base.legalForm,
      address: orsr.data.registeredAddress || base.address,
      registrationDate: orsr.data.registrationDate || base.registrationDate,
      registrationNumberText:
        orsr.data.registrationNumber || base.registrationNumberText,
    };
  }

  return {
    data: merged,
    registry: orsr.data,
    sources: [finstat.company.status, orsr.status, cadastre.status],
  };
}


export async function runFinancialProvider(
  ico: string,
  finstat: FinstatBundle,
): Promise<{ data: FinancialYear[]; sources: ProviderSourceStatus[] }> {
  const ruz = await safe(ruzFinancials(ico), {
    data: [] as FinancialYear[],
    status: { source: "ruz" as const, capability: "financials" as const, state: "error" as const },
  });
  const merged = mergeFinancials(finstat.financials.data, ruz.data);
  return { data: merged, sources: [finstat.financials.status, ruz.status] };
}

export async function runRiskProvider(
  ico: string,
  finstat: FinstatBundle,
): Promise<{ data: RiskIndicator[]; sources: ProviderSourceStatus[] }> {
  const [fa, si, hi, ju, en, ai] = await Promise.all([
    safe(financialAdminRisks(ico), { data: [] as RiskIndicator[], status: err("financial_admin") }),
    safe(socialInsuranceRisks(ico), { data: [] as RiskIndicator[], status: err("social_insurance") }),
    safe(healthInsuranceRisks(ico), { data: [] as RiskIndicator[], status: err("health_insurance") }),
    safe(justiceRisks(ico), { data: [] as RiskIndicator[], status: err("justice") }),
    safe(enforcementRisks(ico), { data: [] as RiskIndicator[], status: err("enforcement") }),
    safe(aiRiskAnalysis(ico), { data: undefined, status: err("ai") }),
  ]);
  const combined = mergeRisks(finstat.risks.data, fa.data, si.data, hi.data, ju.data, en.data);
  return {
    data: combined,
    sources: [finstat.risks.status, fa.status, si.status, hi.status, ju.status, en.status, ai.status],
  };
}

export async function runPeopleProvider(
  ico: string,
  finstat: FinstatBundle,
  orsrPeople: CompanyPerson[] = [],
): Promise<{ data: CompanyPerson[]; sources: ProviderSourceStatus[] }> {
  const rpvs = await safe(rpvsBeneficialOwners(ico), {
    data: [] as CompanyPerson[],
    status: err("rpvs"),
  });
  // ORSR statutory reps take priority over Finstat's executives.
  return {
    data: mergePeople(orsrPeople, finstat.people.data, rpvs.data),
    sources: [finstat.people.status, rpvs.status],
  };
}

export async function runContractsProvider(
  ico: string,
): Promise<{ data: GovContract[]; sources: ProviderSourceStatus[] }> {
  const [crz, uvo] = await Promise.all([
    safe(crzContracts(ico), { data: [] as GovContract[], status: err("crz") }),
    safe(uvoContracts(ico), { data: [] as GovContract[], status: err("uvo") }),
  ]);
  return { data: [...crz.data, ...uvo.data], sources: [crz.status, uvo.status] };
}

export async function runStatementsProvider(
  ico: string,
  diagnostics?: import("./types").ProviderDiagnostic[],
): Promise<{ data: import("@/lib/types").AccountingStatement[]; sources: ProviderSourceStatus[] }> {
  const { ruzStatements } = await import("./ruz.provider.server");
  const result = await safe(ruzStatements(ico, diagnostics), {
    data: [] as import("@/lib/types").AccountingStatement[],
    status: { source: "ruz" as const, capability: "statements" as const, state: "error" as const },
  });
  return { data: result.data, sources: [result.status] };
}


export async function runMonitoringProvider(
  ico: string,
): Promise<{ data: MonitoringSnapshot | undefined; sources: ProviderSourceStatus[] }> {
  const m = await safe(internalMonitoring(ico), {
    data: undefined as MonitoringSnapshot | undefined,
    status: err("internal", "monitoring" as const),
  });
  return { data: m.data, sources: [m.status] };
}

// ---------- merging helpers ----------

function mergeFinancials(a: FinancialYear[], b: FinancialYear[]): FinancialYear[] {
  const byYear = new Map<number, FinancialYear>();
  for (const row of [...a, ...b]) {
    const prev = byYear.get(row.year);
    byYear.set(row.year, prev ? { ...prev, ...row } : row);
  }
  return [...byYear.values()].sort((x, y) => x.year - y.year);
}

function mergeRisks(...groups: RiskIndicator[][]): RiskIndicator[] {
  const byKey = new Map<string, RiskIndicator>();
  for (const group of groups) {
    for (const r of group) {
      const prev = byKey.get(r.key);
      if (!prev || severity(r.status) > severity(prev.status)) byKey.set(r.key, r);
    }
  }
  return [...byKey.values()];
}

function severity(s: RiskIndicator["status"]): number {
  return s === "critical" ? 2 : s === "warning" ? 1 : 0;
}

function mergePeople(...groups: CompanyPerson[][]): CompanyPerson[] {
  const key = (p: CompanyPerson) => `${p.role}::${p.name.trim().toLowerCase()}`;
  const map = new Map<string, CompanyPerson>();
  for (const group of groups) {
    for (const p of group) {
      const k = key(p);
      if (!map.has(k)) map.set(k, p);
    }
  }
  return [...map.values()];
}

function err(source: "orsr" | "ruz" | "rpvs" | "financial_admin" | "social_insurance" | "health_insurance" | "crz" | "uvo" | "justice" | "enforcement" | "cadastre" | "ai" | "internal", capability: ProviderSourceStatus["capability"] = "company"): ProviderSourceStatus {
  return { source, capability, state: "error" };
}
