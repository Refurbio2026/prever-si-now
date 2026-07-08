// Builds the UnifiedCompany view the UI consumes. This is the single place
// that maps aggregated provider results into the section-tagged shape.
// Server-only — imported by the aggregating server function.

import type {
  AccountingStatement,
  BasicCompanyInfo,
  Company,
  CompanyOwner,
  CompanyPerson,
  FinancialYear,
  ProcurementRecord,
  PublicContract,
  SectionState,
  UnifiedCompany,
} from "@/lib/types";
import type { RegistryDetails } from "./types";

const DEV = process.env.NODE_ENV !== "production";

function toBasicInfo(
  company: Company | undefined,
  registry: RegistryDetails | undefined,
): BasicCompanyInfo | undefined {
  if (!company) return undefined;
  return {
    ico: company.ico,
    dic: company.dic,
    icDph: company.icDph,
    name: company.name,
    legalForm: registry?.legalForm ?? company.legalForm ?? undefined,
    address: registry?.registeredAddress ?? company.address ?? undefined,
    city: company.city ?? undefined,
    registrationDate: registry?.registrationDate ?? company.registrationDate ?? undefined,
    registrationNumberText:
      registry?.registrationNumber ?? company.registrationNumberText ?? undefined,
    vatPayer: company.vatPayer,
    vatPayerConfidence: company.vatPayerConfidence,
    skNaceCode: company.skNaceCode,
    skNaceText: company.skNaceText,
    employees: company.employees,
    industry: company.industry,
    website: company.website,
    status: registry?.status,
  };
}

function toOwners(people: CompanyPerson[]): CompanyOwner[] {
  const owners: CompanyOwner[] = [];
  for (const p of people) {
    if (p.role !== "owner" && p.role !== "beneficial_owner") continue;
    owners.push({
      name: p.name,
      share: p.share,
      since: p.since,
      address: p.address,
      role: p.role,
    });
  }
  return owners;
}

export function buildUnifiedCompany(input: {
  company: Company | undefined;
  registry: RegistryDetails | undefined;
  financials: FinancialYear[];
  statements: AccountingStatement[];
  people: CompanyPerson[];
  contracts: PublicContract[];
  contractsState?: SectionState;
  procurement: ProcurementRecord[];
  procurementState?: SectionState;
}): UnifiedCompany {
  return {
    basicInfo: { provider: "orsr", data: toBasicInfo(input.company, input.registry) },
    financials: { provider: "finstat", data: input.financials },
    owners: { provider: "rpvs", data: toOwners(input.people) },
    accounting: { provider: "ruz", data: input.statements },
    contracts: { provider: "crz", data: input.contracts, state: input.contractsState },
    procurement: { provider: "uvo", data: input.procurement, state: input.procurementState },
  };
}

/** Dev-only mock fallback — reserved hook, no-op today. */
export function withDevMockFallback(unified: UnifiedCompany): UnifiedCompany {
  if (!DEV) return unified;
  return unified;
}
