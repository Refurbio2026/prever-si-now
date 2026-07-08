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
  UnifiedCompany,
} from "@/lib/types";
import type { GovContract, RegistryDetails } from "./types";

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
    skNaceCode: company.skNaceCode,
    skNaceText: company.skNaceText,
    employees: company.employees,
    industry: company.industry,
    website: company.website,
    status: registry?.status,
  };
}

function toOwners(people: CompanyPerson[]): CompanyOwner[] {
  return people
    .filter((p) => p.role === "owner" || p.role === "beneficial_owner")
    .map((p) => ({
      name: p.name,
      share: p.share,
      since: p.since,
      address: p.address,
      role: p.role,
    }));
}

function toContracts(all: GovContract[]): PublicContract[] {
  return all
    .filter((c) => c.source === "crz")
    .map(({ id, title, counterparty, value, currency, signedAt, url }) => ({
      id,
      title,
      counterparty,
      value,
      currency,
      signedAt,
      url,
    }));
}

function toProcurement(all: GovContract[]): ProcurementRecord[] {
  return all
    .filter((c) => c.source === "uvo")
    .map(({ id, title, counterparty, value, currency, signedAt, url }) => ({
      id,
      title,
      counterparty,
      value,
      currency,
      signedAt,
      url,
    }));
}

export function buildUnifiedCompany(input: {
  company: Company | undefined;
  registry: RegistryDetails | undefined;
  financials: FinancialYear[];
  statements: AccountingStatement[];
  people: CompanyPerson[];
  contracts: GovContract[];
}): UnifiedCompany {
  return {
    basicInfo: { provider: "orsr", data: toBasicInfo(input.company, input.registry) },
    financials: { provider: "finstat", data: input.financials },
    owners: { provider: "rpvs", data: toOwners(input.people) },
    accounting: { provider: "ruz", data: input.statements },
    contracts: { provider: "crz", data: toContracts(input.contracts) },
    procurement: { provider: "uvo", data: toProcurement(input.contracts) },
  };
}

/** Dev-only mock fallback — only used when a section has no data at all. */
export function withDevMockFallback(unified: UnifiedCompany): UnifiedCompany {
  if (!DEV) return unified;
  // We intentionally leave sections empty in production so the UI shows
  // "Nedostupné". In dev, still leave empty — mock is only enabled here for
  // ad-hoc developer testing when explicitly requested. Kept as a hook so
  // future dev-only seeding lives in one place.
  return unified;
}
