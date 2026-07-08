// Finstat provider — aggregates company/financials/people/risks from Finstat.
// This is the only currently-live upstream. Other registries live in sibling
// provider files and return `unavailable` until wired up.

import type { Company, CompanyPerson, FinancialYear, RiskIndicator } from "@/lib/types";
import { empty, ok, unavailable, type ProviderResult } from "./base.server";
import type { ProviderCapability } from "./types";

async function loadFinstat() {
  const mod = await import("@/lib/finstat.server");
  return mod;
}

async function getRaw(ico: string) {
  const { getFinstatEnvStatus, finstatGetByIco, mockCompanyDetail, FinstatError } =
    await loadFinstat();

  const env = getFinstatEnvStatus();
  if (!env.allSet) {
    return { raw: null, mock: mockCompanyDetail(ico), reason: "not_configured" as const };
  }
  try {
    const raw = await finstatGetByIco(ico);
    return { raw, mock: null, reason: null };
  } catch (err) {
    const fe = err as InstanceType<typeof FinstatError>;
    if (fe?.code === "unauthorized" || fe?.code === "missing_credentials") {
      return { raw: null, mock: mockCompanyDetail(ico), reason: "not_configured" as const };
    }
    if (fe?.code === "not_found") {
      return { raw: null, mock: null, reason: "empty" as const };
    }
    throw err;
  }
}

export async function finstatFetchAll(ico: string): Promise<{
  company: ProviderResult<Company | undefined>;
  financials: ProviderResult<FinancialYear[]>;
  people: ProviderResult<CompanyPerson[]>;
  risks: ProviderResult<RiskIndicator[]>;
}> {
  const { normalizeDetail } = await loadFinstat();

  const emptyResult = <T,>(cap: ProviderCapability, fallback: T, reason: "empty" | "not_configured") =>
    reason === "not_configured"
      ? unavailable<T>("finstat", cap, fallback, "not_configured", "Finstat API nie je nakonfigurované.")
      : empty<T>("finstat", cap, fallback, "Firma nebola nájdená.");

  try {
    const { raw, mock, reason } = await getRaw(ico);
    if (raw) {
      const bundle = normalizeDetail(raw);
      return {
        company: ok("finstat", "company", bundle.company),
        financials: ok("finstat", "financials", bundle.financials),
        people: ok("finstat", "people", bundle.people),
        risks: ok("finstat", "risks", bundle.risks),
      };
    }
    if (mock) {
      return {
        company: unavailable("finstat", "company", mock.company, "not_configured", "Zobrazujem ukážkové dáta."),
        financials: unavailable("finstat", "financials", mock.financials, "not_configured"),
        people: unavailable("finstat", "people", mock.people, "not_configured"),
        risks: unavailable("finstat", "risks", mock.risks, "not_configured"),
      };
    }
    return {
      company: emptyResult<Company | undefined>("company", undefined, reason ?? "empty"),
      financials: emptyResult<FinancialYear[]>("financials", [], reason ?? "empty"),
      people: emptyResult<CompanyPerson[]>("people", [], reason ?? "empty"),
      risks: emptyResult<RiskIndicator[]>("risks", [], reason ?? "empty"),
    };
  } catch (err) {
    const message = (err as Error).message;
    return {
      company: unavailable<Company | undefined>("finstat", "company", undefined, "error", message),
      financials: unavailable<FinancialYear[]>("finstat", "financials", [], "error", message),
      people: unavailable<CompanyPerson[]>("finstat", "people", [], "error", message),
      risks: unavailable<RiskIndicator[]>("finstat", "risks", [], "error", message),
    };
  }
}
