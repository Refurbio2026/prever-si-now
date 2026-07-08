// Server-only Finstat client + response normalization.
// Never import this file from client-reachable modules directly.
// Access it from a createServerFn handler via `await import(...)`.

import {
  buildSignedFinstatRequest,
  FinstatAuthError,
  getFinstatEnvStatus,
  type FinstatEnvStatus,
} from "./finstat/auth";

import type {
  Company,
  CompanyPerson,
  CompanySearchResult,
  FinancialYear,
  FinstatRawCompany,
  FinstatSearchHit,
  RiskIndicator,
  RiskLevel,
} from "./types";

export type { FinstatEnvStatus };
export { getFinstatEnvStatus };

export class FinstatError extends Error {
  code:
    | "missing_query"
    | "missing_credentials"
    | "not_found"
    | "rate_limit"
    | "unauthorized"
    | "server_error"
    | "network_error";
  status?: number;
  rawResponse?: string;
  endpoint?: string;
  finalUrlMasked?: string;
  hashBaseMasked?: string;
  generatedHash?: string;
  constructor(
    code: FinstatError["code"],
    message: string,
    extra?: {
      status?: number;
      rawResponse?: string;
      endpoint?: string;
      finalUrlMasked?: string;
      hashBaseMasked?: string;
      generatedHash?: string;
    },
  ) {
    super(message);
    this.code = code;
    this.name = "FinstatError";
    this.status = extra?.status;
    this.rawResponse = extra?.rawResponse;
    this.endpoint = extra?.endpoint;
    this.finalUrlMasked = extra?.finalUrlMasked;
    this.hashBaseMasked = extra?.hashBaseMasked;
    this.generatedHash = extra?.generatedHash;
  }
}

export function looksLikeIco(query: string): boolean {
  return /^\d{6,8}$/.test(query.trim());
}


function mapStatusFromResponse(
  status: number,
  endpoint: string,
  body: string,
  signed: Pick<SignedDiagnostic, "finalUrlMasked" | "hashBaseMasked" | "generatedHash">,
): FinstatError {
  if (status === 401 || status === 403) {
    return new FinstatError("unauthorized", "Invalid Finstat API credentials.", {
      status,
      endpoint,
      rawResponse: body,
      ...signed,
    });
  }
  if (status === 404)
    return new FinstatError("not_found", "Company not found.", {
      status,
      endpoint,
      rawResponse: body,
      ...signed,
    });
  if (status === 429)
    return new FinstatError("rate_limit", "Finstat rate limit reached.", {
      status,
      endpoint,
      rawResponse: body,
      ...signed,
    });
  return new FinstatError("server_error", `Finstat responded with HTTP ${status}.`, {
    status,
    endpoint,
    rawResponse: body,
    ...signed,
  });
}

interface SignedDiagnostic {
  finalUrlMasked: string;
  hashBaseMasked: string;
  generatedHash: string;
}

export interface FinstatFetchResult {
  endpoint: string;
  finalUrlMasked: string;
  hashBaseMasked: string;
  generatedHash: string;
  status: number;
  rawResponse: string;
  parsed: unknown;
}

async function finstatFetchRaw(
  path: string,
  params: Record<string, string>,
  hashInput: string,
): Promise<FinstatFetchResult> {
  let signed;
  try {
    signed = buildSignedFinstatRequest(path, params, hashInput);
  } catch (err) {
    if (err instanceof FinstatAuthError) {
      throw new FinstatError("missing_credentials", err.message);
    }
    throw err;
  }
  let res: Response;
  try {
    res = await fetch(signed.finalUrl, {
      method: signed.method,
      headers: signed.headers,
    });
  } catch (err) {
    throw new FinstatError(
      "network_error",
      `Network error contacting Finstat: ${(err as Error).message}`,
      {
        endpoint: signed.endpoint,
        finalUrlMasked: signed.finalUrlMasked,
        hashBaseMasked: signed.hashBaseMasked,
        generatedHash: signed.hash,
      },
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw mapStatusFromResponse(res.status, signed.endpoint, text, {
      finalUrlMasked: signed.finalUrlMasked,
      hashBaseMasked: signed.hashBaseMasked,
      generatedHash: signed.hash,
    });
  }
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new FinstatError("server_error", "Finstat returned a non-JSON response.", {
        status: res.status,
        endpoint: signed.endpoint,
        rawResponse: text,
          finalUrlMasked: signed.finalUrlMasked,
          hashBaseMasked: signed.hashBaseMasked,
          generatedHash: signed.hash,
      });
    }
  }
  return {
    endpoint: signed.endpoint,
    finalUrlMasked: signed.finalUrlMasked,
    hashBaseMasked: signed.hashBaseMasked,
    generatedHash: signed.hash,
    status: res.status,
    rawResponse: text,
    parsed,
  };
}

async function finstatFetch(
  path: string,
  params: Record<string, string>,
  hashInput: string,
): Promise<unknown> {
  const { parsed } = await finstatFetchRaw(path, params, hashInput);
  return parsed;

}

// ---------- Mock fallback (used when credentials are missing) ----------

export const MOCK_ICO = "31333532";

export function mockCompanyDetail(ico: string): CompanyDetailBundle {
  const raw: FinstatRawCompany = {
    Ico: ico,
    Dic: "2020317068",
    IcDph: "SK2020317068",
    Name: "ESET, spol. s r.o. (MOCK)",
    LegalForm: "Spoločnosť s ručením obmedzeným",
    Street: "Einsteinova",
    StreetNumber: "24",
    City: "Bratislava",
    ZipCode: "851 01",
    Created: "1992-06-16",
    EmployeeCount: 1000,
    Url: "https://www.eset.com",
    SkNace: { Code: "62010", Name: "Počítačové programovanie" },
    Sales: 250000000,
    Profit: 90000000,
    ReliableVatPayer: true,
    Financials: [
      { Year: 2021, Sales: 200000000, Profit: 60000000, Ebitda: 80000000, Assets: 500000000, Liabilities: 100000000 },
      { Year: 2022, Sales: 230000000, Profit: 75000000, Ebitda: 95000000, Assets: 550000000, Liabilities: 110000000 },
      { Year: 2023, Sales: 250000000, Profit: 90000000, Ebitda: 110000000, Assets: 600000000, Liabilities: 120000000 },
    ],
    Persons: [{ Name: "Richard Marko", Function: "konateľ", From: "2011-01-01" }],
    Owners: [{ Name: "Rudolf Hrubý", Share: 40, From: "1992-06-16" }],
    KUVs: [{ Name: "Rudolf Hrubý", Share: 40, From: "2017-01-01" }],
  };
  return normalizeDetail(raw);
}

export interface FinstatDiagnostic {
  usingMock: boolean;
  envStatus: FinstatEnvStatus;
  endpoint: string | null;
  hashBaseMasked: string | null;
  generatedHash: string | null;
  finalRequestUrlMasked: string | null;
  httpStatus: number | null;
  rawResponse: string | null;
  rawResponsePreview: string | null;
  normalizedPreview: Company | null;
  errorMessage: string | null;
  errorCode: string | null;
}

export async function runFinstatDiagnostic(ico: string): Promise<FinstatDiagnostic> {
  const envStatus = getFinstatEnvStatus();
  if (!envStatus.allSet) {
    return {
      usingMock: false,
      envStatus,
      endpoint: null,
      hashBaseMasked: null,
      generatedHash: null,
      finalRequestUrlMasked: null,
      httpStatus: null,
      rawResponse: null,
      rawResponsePreview: null,
      normalizedPreview: null,
      errorMessage: "Finstat API credentials are not configured. No mock request was used.",
      errorCode: "missing_credentials",
    };
  }

  try {
    const { endpoint, finalUrlMasked, hashBaseMasked, generatedHash, status, rawResponse, parsed } = await finstatFetchRaw(
      "/detail",
      { ico },
      ico,
    );

    const raw = parsed as FinstatRawCompany | null;
    if (!raw || !raw.Ico) {
      return {
        usingMock: false,
        envStatus,
        endpoint,
        hashBaseMasked,
        generatedHash,
        finalRequestUrlMasked: finalUrlMasked,
        httpStatus: status,
        rawResponse,
        rawResponsePreview: rawResponse.slice(0, 500),
        normalizedPreview: null,
        errorMessage: `Company with IČO ${ico} not found.`,
        errorCode: "not_found",
      };
    }
    return {
      usingMock: false,
      envStatus,
      endpoint,
      hashBaseMasked,
      generatedHash,
      finalRequestUrlMasked: finalUrlMasked,
      httpStatus: status,
      rawResponse,
      rawResponsePreview: rawResponse.slice(0, 500),
      normalizedPreview: normalizeDetail(raw).company,
      errorMessage: null,
      errorCode: null,
    };
  } catch (err) {
    const fe = err as FinstatError;
    return {
      usingMock: false,
      envStatus,
      endpoint: fe.endpoint ?? null,
      hashBaseMasked: fe.hashBaseMasked ?? null,
      generatedHash: fe.generatedHash ?? null,
      finalRequestUrlMasked: fe.finalUrlMasked ?? null,
      httpStatus: fe.status ?? null,
      rawResponse: fe.rawResponse ?? null,
      rawResponsePreview: fe.rawResponse ? fe.rawResponse.slice(0, 500) : null,
      normalizedPreview: null,
      errorMessage: fe.message ?? "Unknown error",
      errorCode: fe.code ?? "unknown",
    };
  }
}

/** Raw search response — useful for debug pages. Never throws on parse issues. */
export async function finstatSearchByNameRaw(query: string): Promise<unknown> {
  return finstatFetch("/autocomplete", { query }, query);
}

export async function finstatSearchByName(query: string): Promise<CompanySearchResult[]> {
  const raw = await finstatSearchByNameRaw(query);
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log("[finstat] /autocomplete raw response:", JSON.stringify(raw));
  }
  return normalizeSearchResponse(raw);
}


export async function finstatGetByIco(ico: string): Promise<FinstatRawCompany> {
  const data = (await finstatFetch("/detail", { ico }, ico)) as FinstatRawCompany | null;
  if (!data || !data.Ico) throw new FinstatError("not_found", `Company with IČO ${ico} not found.`);
  return data;
}


// ---------- Normalization ----------

function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 75) return "low";
  if (score >= 50) return "medium";
  return "high";
}

function computeRiskScore(raw: FinstatRawCompany): number {
  let score = 90;
  if ((raw.JudicialDebt ?? 0) > 0) score -= 20;
  if ((raw.SocialInsuranceDebt ?? 0) > 0) score -= 15;
  if ((raw.HealthInsuranceDebt ?? 0) > 0) score -= 15;
  if (raw.BankruptcyInfo) score -= 30;
  if (raw.DistrainmentsInfo?.Distrainments?.length) score -= 15;
  if (raw.UnreliableVatPayer) score -= 20;
  if ((raw.Profit ?? 0) < 0) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function joinAddress(raw: FinstatRawCompany): { address: string; city: string } {
  const address = [raw.Street, raw.StreetNumber].filter(Boolean).join(" ").trim();
  const city = [raw.ZipCode, raw.City].filter(Boolean).join(" ").trim();
  return { address: address || "—", city: city || "—" };
}

export function normalizeCompany(raw: FinstatRawCompany): Company {
  const { address, city } = joinAddress(raw);
  const score = computeRiskScore(raw);
  const financials = normalizeFinancials(raw);
  const latestFin = financials.length ? financials[financials.length - 1] : undefined;
  const warnings = collectStrings(raw.Warnings ?? undefined, raw.Warning ?? undefined);
  const paymentOrders = collectStrings(
    raw.PaymentOrderInfo?.PaymentOrders ?? raw.PaymentOrders ?? undefined,
    raw.PaymentOrder ?? undefined,
  );
  return {
    ico: String(raw.Ico ?? ""),
    dic: raw.Dic || undefined,
    icDph: raw.IcDph || undefined,
    name: raw.Name ?? "Neznáma firma",
    legalForm: raw.LegalForm ?? "—",
    address,
    city,
    registrationDate: raw.Created ?? "",
    vatPayer: !!raw.IcDph || !!raw.ReliableVatPayer,
    revenue: Number(raw.Sales ?? latestFin?.revenue ?? 0),
    profit: Number(raw.Profit ?? latestFin?.profit ?? 0),
    riskScore: score,
    riskLevel: riskLevelFromScore(score),
    employees: raw.EmployeeCount ? Number(raw.EmployeeCount) : undefined,
    industry: raw.SkNace?.Name || raw.Activity || undefined,
    website: raw.Url || undefined,
    registrationNumberText: raw.RegisterNumberText ?? undefined,
    skNaceCode: raw.SkNace?.Code ?? undefined,
    skNaceText: raw.SkNace?.Name ?? undefined,
    latestAssets: latestFin?.assets ?? (raw.Assets != null ? Number(raw.Assets) : undefined),
    latestLiabilities:
      latestFin?.liabilities ?? (raw.Liabilities != null ? Number(raw.Liabilities) : undefined),
    warnings: warnings.length ? warnings : undefined,
    paymentOrderWarnings: paymentOrders.length ? paymentOrders : undefined,
    debtIndicators: {
      taxDebt: raw.TaxDebt != null ? Number(raw.TaxDebt) : undefined,
      judicialDebt: raw.JudicialDebt != null ? Number(raw.JudicialDebt) : undefined,
      socialDebt: raw.SocialInsuranceDebt != null ? Number(raw.SocialInsuranceDebt) : undefined,
      healthDebt: raw.HealthInsuranceDebt != null ? Number(raw.HealthInsuranceDebt) : undefined,
    },
  };
}

function safeTrim(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function collectStrings(
  list: unknown,
  single: unknown,
): string[] {
  const out: string[] = [];
  const s = safeTrim(single);
  if (s) out.push(s);
  if (Array.isArray(list)) {
    for (const item of list) {
      const direct = safeTrim(item);
      if (direct) {
        out.push(direct);
        continue;
      }
      if (item && typeof item === "object") {
        const obj = item as { Text?: unknown; Description?: unknown };
        const t = safeTrim(obj.Text) ?? safeTrim(obj.Description);
        if (t) out.push(t);
      }
    }
  }
  return out;
}

/** Light-weight search hit → CompanySearchResult (name search path). */
export function normalizeSearchHit(hit: FinstatSearchHit): CompanySearchResult {
  const addressParts = [hit.Street, hit.ZipCode, hit.City].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  return {
    ico: String(hit.Ico ?? ""),
    name: typeof hit.Name === "string" ? hit.Name : "Neznáma firma",
    address: addressParts.length ? addressParts.join(" ") : undefined,
  };
}

/**
 * Defensive normalizer for the Finstat search / autocomplete endpoint.
 * Accepts any shape (array, single object, `{ Results }`, `{ Companies }`,
 * `{ Data }`, `{ Suggestions }`, etc.) and never throws.
 */
export function normalizeSearchResponse(raw: unknown): CompanySearchResult[] {
  if (raw == null) return [];

  // Array of hits.
  if (Array.isArray(raw)) {
    return raw.flatMap(hitToResult);
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    // Known collection keys used by Finstat / similar registries.
    for (const key of ["Results", "Companies", "Data", "Items", "Suggestions", "Hits"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v.flatMap(hitToResult);
    }

    // Single company object shape (has Ico).
    if ("Ico" in obj || "ico" in obj) {
      return hitToResult(obj);
    }
  }

  return [];
}

function hitToResult(item: unknown): CompanySearchResult[] {
  if (!item || typeof item !== "object") return [];
  const o = item as Record<string, unknown>;
  const ico = o.Ico ?? o.ico;
  const name = o.Name ?? o.name;
  if (ico == null && name == null) return [];
  const hit: FinstatSearchHit = {
    Ico: ico != null ? String(ico) : undefined,
    Name: typeof name === "string" ? name : name != null ? String(name) : undefined,
    Street: typeof o.Street === "string" ? o.Street : undefined,
    City: typeof o.City === "string" ? o.City : undefined,
    ZipCode: typeof o.ZipCode === "string" ? o.ZipCode : undefined,
    Region: typeof o.Region === "string" ? o.Region : undefined,
  };
  return [normalizeSearchHit(hit)];
}


/** Full Finstat detail → CompanySearchResult (IČO search path — includes financials, risks). */
export function companyToSearchResult(
  company: Company,
  warningIndicators?: string[],
): CompanySearchResult {
  return {
    name: company.name,
    ico: company.ico,
    dic: company.dic,
    address: [company.address, company.city].filter((v) => v && v !== "—").join(", ") || undefined,
    legalForm: company.legalForm && company.legalForm !== "—" ? company.legalForm : undefined,
    riskScore: company.riskScore,
    revenue: company.revenue || undefined,
    profit: company.profit || undefined,
    warningIndicators:
      warningIndicators?.length ? warningIndicators : company.warnings,
  };
}

export function normalizeFinancials(raw: FinstatRawCompany): FinancialYear[] {
  const rows = raw.Financials ?? [];
  return rows
    .filter((r) => typeof r.Year === "number")
    .map((r) => ({
      year: r.Year as number,
      revenue: Number(r.Sales ?? 0),
      profit: Number(r.Profit ?? 0),
      ebitda: Number(r.Ebitda ?? 0),
      assets: Number(r.Assets ?? 0),
      liabilities: Number(r.Liabilities ?? 0),
    }))
    .sort((a, b) => a.year - b.year);
}

export function normalizePeople(raw: FinstatRawCompany): CompanyPerson[] {
  const executives: CompanyPerson[] = (raw.Persons ?? []).map((p) => ({
    name: p.Name ?? "—",
    role: "executive" as const,
    since: p.From ?? "",
  }));
  const owners: CompanyPerson[] = (raw.Owners ?? []).map((p) => ({
    name: p.Name ?? "—",
    role: "owner" as const,
    since: p.From ?? "",
    share: typeof p.Share === "number" ? p.Share : undefined,
  }));
  const beneficials: CompanyPerson[] = (raw.KUVs ?? []).map((p) => ({
    name: p.Name ?? "—",
    role: "beneficial_owner" as const,
    since: p.From ?? "",
    share: typeof p.Share === "number" ? p.Share : undefined,
  }));
  return [...executives, ...owners, ...beneficials];
}

export function normalizeRisks(raw: FinstatRawCompany): RiskIndicator[] {
  const tax = Number(raw.JudicialDebt ?? 0);
  const social = Number(raw.SocialInsuranceDebt ?? 0);
  const health = Number(raw.HealthInsuranceDebt ?? 0);
  const executions = raw.DistrainmentsInfo?.Distrainments?.length ?? 0;
  const insolvency = !!raw.BankruptcyInfo;
  const unreliable = !!raw.UnreliableVatPayer;

  return [
    {
      key: "tax_debt",
      label: "Daňový nedoplatok",
      status: tax > 0 ? "critical" : "clear",
      detail: tax > 0 ? "Evidovaný nedoplatok" : "Bez nedoplatkov",
      amount: tax > 0 ? tax : undefined,
    },
    {
      key: "social_debt",
      label: "Sociálna poisťovňa",
      status: social > 0 ? "warning" : "clear",
      detail: social > 0 ? "Evidovaný nedoplatok" : "Bez nedoplatkov",
      amount: social > 0 ? social : undefined,
    },
    {
      key: "health_debt",
      label: "Zdravotné poisťovne",
      status: health > 0 ? "warning" : "clear",
      detail: health > 0 ? "Evidovaný nedoplatok" : "Bez nedoplatkov",
      amount: health > 0 ? health : undefined,
    },
    {
      key: "insolvency",
      label: "Konkurz / reštrukturalizácia",
      status: insolvency ? "critical" : "clear",
      detail: insolvency ? "Evidované konanie" : "Neevidované",
    },
    {
      key: "executions",
      label: "Exekučné konania",
      status: executions > 0 ? "critical" : "clear",
      detail: executions > 0 ? `${executions} aktívnych konaní` : "Bez konaní",
    },
    {
      key: "vat_reliability",
      label: "Spoľahlivosť platiteľa DPH",
      status: unreliable ? "warning" : "clear",
      detail: unreliable
        ? "Nespoľahlivý platiteľ DPH"
        : raw.IcDph
        ? "Spoľahlivý platiteľ"
        : "Nie je platiteľom DPH",
    },
  ];
}

export interface CompanyDetailBundle {
  company: Company;
  financials: FinancialYear[];
  people: CompanyPerson[];
  risks: RiskIndicator[];
}

export function normalizeDetail(raw: FinstatRawCompany): CompanyDetailBundle {
  return {
    company: normalizeCompany(raw),
    financials: normalizeFinancials(raw),
    people: normalizePeople(raw),
    risks: normalizeRisks(raw),
  };
}
