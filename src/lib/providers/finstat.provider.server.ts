// Finstat provider — aggregates company/financials/people/risks from Finstat.
// This is the only currently-live upstream. Other registries live in sibling
// provider files and return `unavailable` until wired up.

import type { Company, CompanyPerson, FinancialYear, RiskIndicator } from "@/lib/types";
import { empty, ok, unavailable, type ProviderResult } from "./base.server";
import type { ProviderCapability, ProviderDiagnostic } from "./types";

async function loadFinstat() {
  const mod = await import("@/lib/finstat.server");
  return mod;
}

const ALLOW_MOCK = process.env.NODE_ENV !== "production";

interface RawFetchResult {
  raw: Awaited<ReturnType<Awaited<ReturnType<typeof loadFinstat>>["finstatGetByIco"]>> | null;
  mock: ReturnType<Awaited<ReturnType<typeof loadFinstat>>["mockCompanyDetail"]> | null;
  reason: "not_configured" | "empty" | "error" | null;
  errorMessage?: string;
}

async function getRaw(
  ico: string,
  diagnostics?: ProviderDiagnostic[],
): Promise<RawFetchResult> {
  const { getFinstatEnvStatus, finstatGetByIco, mockCompanyDetail, FinstatError } =
    await loadFinstat();

  const env = getFinstatEnvStatus();
  if (!env.allSet) {
    diagnostics?.push({
      source: "finstat",
      capability: "company",
      endpoint: "/detail",
      errorCode: "missing_credentials",
      normalizedError: "Finstat API kľúče nie sú nastavené.",
    });
    return {
      raw: null,
      mock: ALLOW_MOCK ? mockCompanyDetail(ico) : null,
      reason: "not_configured",
    };
  }
  try {
    const raw = await finstatGetByIco(ico);
    return { raw, mock: null, reason: null };
  } catch (err) {
    const fe = err as InstanceType<typeof FinstatError>;
    diagnostics?.push({
      source: "finstat",
      capability: "company",
      endpoint: fe?.endpoint ?? "/detail",
      httpStatus: fe?.status,
      errorCode: fe?.code ?? "unknown",
      rawError: fe?.rawResponse?.slice(0, 800),
      normalizedError: fe?.message,
      finalUrlMasked: fe?.finalUrlMasked,
    });
    if (fe?.code === "unauthorized" || fe?.code === "missing_credentials") {
      return {
        raw: null,
        mock: ALLOW_MOCK ? mockCompanyDetail(ico) : null,
        reason: "not_configured",
      };
    }
    if (fe?.code === "not_found") {
      return { raw: null, mock: null, reason: "empty" };
    }
    return { raw: null, mock: null, reason: "error", errorMessage: fe?.message };
  }
}

export async function finstatFetchAll(
  ico: string,
  diagnostics?: ProviderDiagnostic[],
): Promise<{
  company: ProviderResult<Company | undefined>;
  financials: ProviderResult<FinancialYear[]>;
  people: ProviderResult<CompanyPerson[]>;
  risks: ProviderResult<RiskIndicator[]>;
}> {
  const { normalizeDetail } = await loadFinstat();

  const emptyResult = <T,>(cap: ProviderCapability, fallback: T, reason: "empty" | "not_configured" | "error", message?: string) => {
    if (reason === "not_configured") {
      return unavailable<T>("finstat", cap, fallback, "not_configured", "Finstat API nie je nakonfigurované.");
    }
    if (reason === "error") {
      return unavailable<T>("finstat", cap, fallback, "error", message ?? "Chyba pri komunikácii s Finstat.");
    }
    return empty<T>("finstat", cap, fallback, "Firma nebola nájdená.");
  };

  const { raw, mock, reason, errorMessage } = await getRaw(ico, diagnostics);
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
  const r = reason ?? "empty";
  return {
    company: emptyResult<Company | undefined>("company", undefined, r, errorMessage),
    financials: emptyResult<FinancialYear[]>("financials", [], r, errorMessage),
    people: emptyResult<CompanyPerson[]>("people", [], r, errorMessage),
    risks: emptyResult<RiskIndicator[]>("risks", [], r, errorMessage),
  };
}

