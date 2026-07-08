// Domain providers — each aggregates one capability across all upstream
// sources. Adding a Czech provider later means adding one file and one line
// to the relevant provider below; the UI needs zero changes.

import type { Company, CompanyPerson, FinancialYear, RiskIndicator } from "@/lib/types";
import type {
  FieldMergeAudit,
  MonitoringSnapshot,
  ProviderDiagnostic,
  ProviderSourceId,
  ProviderSourceStatus,
  RegistryDetails,
} from "./types";

import { finstatFetchAll } from "./finstat.provider.server";
// ORSR provider intentionally not imported — the live scraper is disabled.
// See runCompanyProvider below.
import {
  financialAdminRisks,
  healthInsuranceRisks,
  justiceRisks,
  ruzFinancials,
  socialInsuranceRisks,
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
  _diagnostics?: ProviderDiagnostic[],
  audit?: FieldMergeAudit[],
): Promise<{
  data: Company | undefined;
  registry?: RegistryDetails;
  fieldSources: Record<string, ProviderSourceId>;
  sources: ProviderSourceStatus[];
}> {
  // ORSR live scraping is intentionally disabled — the public ORSR site
  // has no stable machine endpoint. It is marked "Pripravuje sa" in the
  // status grid (IMPLEMENTED_SOURCES) until a real source is wired.
  // Finstat remains the sole fallback for registry/legal fields.
  const cadastre = await safe(cadastreCompanyInfo(ico), {
    data: undefined,
    status: { source: "cadastre" as const, capability: "company" as const, state: "unavailable" as const },
  });

  const base = finstat.company.data;
  const fieldSources: Record<string, ProviderSourceId> = {};

  // Priority merge helper: pick the first candidate whose value is non-empty.
  const pick = <T>(
    field: string,
    candidates: Array<[ProviderSourceId, T | undefined | null]>,
  ): T | undefined => {
    let chosen: T | undefined;
    let chosenSource: ProviderSourceId | null = null;
    let decision = "no provider returned a value";
    for (const [src, val] of candidates) {
      const isEmpty =
        val == null ||
        (typeof val === "string" && val.trim() === "") ||
        (typeof val === "number" && Number.isNaN(val));
      if (!isEmpty && chosen === undefined) {
        chosen = val;
        chosenSource = src;
        decision = `${src} provided the first non-empty value`;
        break;
      }
    }
    if (chosenSource) fieldSources[field] = chosenSource;
    audit?.push({
      field,
      chosenSource,
      chosenValue: toAuditValue(chosen),
      decision,
      candidates: candidates.map(([source, value]) => ({
        source,
        value: toAuditValue(value),
      })),
    });
    return chosen;
  };

  let merged: Company | undefined;
  if (base) {
    merged = {
      ...base,
      // ORSR not implemented — Finstat is the only source for these fields.
      legalForm: pick("legalForm", [["finstat", base.legalForm]]) ?? "",
      address: pick("address", [["finstat", base.address]]) ?? "",
      registrationDate: pick("registrationDate", [["finstat", base.registrationDate]]) ?? "",
      registrationNumberText: pick("registrationNumberText", [
        ["finstat", base.registrationNumberText],
      ]),
    };
    // Finstat-only fields — still record provenance so the UI can show source.
    for (const f of [
      "name",
      "ico",
      "dic",
      "icDph",
      "city",
      "vatPayer",
      "revenue",
      "profit",
      "employees",
      "industry",
      "website",
      "skNaceCode",
      "skNaceText",
      "latestAssets",
      "latestLiabilities",
      "riskScore",
    ] as const) {
      const v = base[f as keyof Company];
      if (v != null && v !== "") fieldSources[f] = "finstat";
    }
  }

  return {
    data: merged,
    registry: undefined,
    fieldSources,
    // Do NOT push an ORSR status here — the grid derives "Pripravuje sa"
    // from IMPLEMENTED_SOURCES when no status entry is present.
    sources: [finstat.company.status, cadastre.status],
  };
}


function toAuditValue(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  try {
    return JSON.stringify(v).slice(0, 200);
  } catch {
    return String(v).slice(0, 200);
  }
}



export async function runFinancialProvider(
  ico: string,
  finstat: FinstatBundle,
): Promise<{ data: FinancialYear[]; sources: ProviderSourceStatus[] }> {
  const ruz = await safe(ruzFinancials(ico), {
    data: [] as FinancialYear[],
    status: { source: "ruz" as const, capability: "financials" as const, state: "unavailable" as const },
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
  diagnostics?: ProviderDiagnostic[],
): Promise<{
  data: CompanyPerson[];
  rpvs?: import("./rpvs.provider.server").RpvsBundle;
  sources: ProviderSourceStatus[];
}> {
  const { rpvsPartnerBundle } = await import("./rpvs.provider.server");
  const rpvs = await safe(rpvsPartnerBundle(ico, diagnostics), {
    data: undefined as import("./rpvs.provider.server").RpvsBundle | undefined,
    status: err("rpvs", "people"),
  });
  const rpvsPeople = rpvs.data?.beneficialOwners ?? [];
  return {
    data: mergePeople(orsrPeople, finstat.people.data, rpvsPeople),
    rpvs: rpvs.data,
    sources: [finstat.people.status, rpvs.status],
  };
}


export async function runContractsProvider(
  ico: string,
  diagnostics?: ProviderDiagnostic[],
): Promise<{
  contracts: {
    data: import("@/lib/types").PublicContract[];
    state: import("@/lib/types").SectionState;
  };
  procurement: {
    data: import("@/lib/types").ProcurementRecord[];
    state: import("@/lib/types").SectionState;
  };
  sources: ProviderSourceStatus[];
}> {
  const { crzContractsByIco } = await import("./crz.provider.server");
  // ÚVO live scraping is intentionally disabled — no stable public endpoint
  // is wired yet. The provider status grid marks it as "Pripravuje sa"
  // via IMPLEMENTED_SOURCES; do NOT push an unavailable status here.
  const crz = await safe(crzContractsByIco(ico, diagnostics), {
    data: [] as import("@/lib/types").PublicContract[],
    status: err("crz", "contracts"),
  });
  const stateOf = (s: ProviderSourceStatus): import("@/lib/types").SectionState =>
    s.state === "ok" ? "ok" : s.state === "empty" ? "empty" : "failed";
  return {
    contracts: { data: crz.data, state: stateOf(crz.status) },
    procurement: {
      data: [] as import("@/lib/types").ProcurementRecord[],
      state: "empty" as import("@/lib/types").SectionState,
    },
    sources: [crz.status],
  };
}


export async function runStatementsProvider(
  ico: string,
  diagnostics?: import("./types").ProviderDiagnostic[],
): Promise<{ data: import("@/lib/types").AccountingStatement[]; sources: ProviderSourceStatus[] }> {
  const { ruzStatements } = await import("./ruz.provider.server");
  const result = await safe(ruzStatements(ico, diagnostics), {
    data: [] as import("@/lib/types").AccountingStatement[],
    status: { source: "ruz" as const, capability: "statements" as const, state: "unavailable" as const },
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
  return { source, capability, state: "unavailable" };
}
