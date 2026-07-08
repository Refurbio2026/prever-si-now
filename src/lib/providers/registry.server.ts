// Placeholder providers for Slovak public registries. Each returns
// `unavailable` with an empty payload — they slot into the aggregator today
// and can be replaced with real fetchers without any UI change.

import type { CompanyPerson, RiskIndicator } from "@/lib/types";
import { unavailable, type ProviderResult } from "./base.server";
import type { GovContract, ProviderSourceId } from "./types";

const soon = (name: string) => `${name}: integrácia sa pripravuje.`;

export async function orsrCompanyInfo(_ico: string): Promise<ProviderResult<undefined>> {
  return unavailable("orsr", "company", undefined, "unavailable", soon("ORSR"));
}

export async function ruzFinancials(_ico: string) {
  return unavailable<[]>("ruz", "financials", [], "unavailable", soon("Register účtovných závierok"));
}

export async function rpvsBeneficialOwners(_ico: string): Promise<ProviderResult<CompanyPerson[]>> {
  return unavailable<CompanyPerson[]>("rpvs", "people", [], "unavailable", soon("RPVS"));
}

export async function financialAdminRisks(_ico: string): Promise<ProviderResult<RiskIndicator[]>> {
  return unavailable<RiskIndicator[]>("financial_admin", "risks", [], "unavailable", soon("Finančná správa"));
}

export async function socialInsuranceRisks(_ico: string): Promise<ProviderResult<RiskIndicator[]>> {
  return unavailable<RiskIndicator[]>("social_insurance", "risks", [], "unavailable", soon("Sociálna poisťovňa"));
}

export async function healthInsuranceRisks(_ico: string): Promise<ProviderResult<RiskIndicator[]>> {
  return unavailable<RiskIndicator[]>("health_insurance", "risks", [], "unavailable", soon("Zdravotné poisťovne"));
}

export async function crzContracts(_ico: string): Promise<ProviderResult<GovContract[]>> {
  return unavailable<GovContract[]>("crz", "contracts", [], "unavailable", soon("CRZ"));
}

export async function uvoContracts(_ico: string): Promise<ProviderResult<GovContract[]>> {
  return unavailable<GovContract[]>("uvo", "contracts", [], "unavailable", soon("ÚVO"));
}

export async function justiceRisks(_ico: string): Promise<ProviderResult<RiskIndicator[]>> {
  return unavailable<RiskIndicator[]>("justice", "risks", [], "unavailable", soon("Justice.gov.sk"));
}

export async function enforcementRisks(_ico: string): Promise<ProviderResult<RiskIndicator[]>> {
  return unavailable<RiskIndicator[]>("enforcement", "risks", [], "unavailable", soon("Centrálny register exekúcií"));
}

export async function cadastreCompanyInfo(_ico: string): Promise<ProviderResult<undefined>> {
  return unavailable("cadastre", "company", undefined, "unavailable", soon("Kataster"));
}

export async function aiRiskAnalysis(_ico: string): Promise<ProviderResult<undefined>> {
  return unavailable("ai", "risks", undefined, "unavailable", soon("Interná AI analýza"));
}

/** Registry lists what capabilities each source claims — useful for
 *  diagnostics and for the aggregator to display "13 sources checked". */
export const REGISTRY: Array<{ id: ProviderSourceId; label: string }> = [
  { id: "finstat", label: "Finstat" },
  { id: "orsr", label: "Obchodný register (ORSR)" },
  { id: "ruz", label: "Register účtovných závierok (RÚZ)" },
  { id: "rpvs", label: "Register partnerov verejného sektora (RPVS)" },
  { id: "financial_admin", label: "Finančná správa" },
  { id: "social_insurance", label: "Sociálna poisťovňa" },
  { id: "health_insurance", label: "Zdravotné poisťovne" },
  { id: "crz", label: "Centrálny register zmlúv (CRZ)" },
  { id: "uvo", label: "Úrad pre verejné obstarávanie (ÚVO)" },
  { id: "justice", label: "Justičný portál" },
  { id: "enforcement", label: "Centrálny register exekúcií" },
  { id: "cadastre", label: "Kataster" },
  { id: "ai", label: "Interná AI analýza" },
  { id: "internal", label: "Interný monitoring" },
];
