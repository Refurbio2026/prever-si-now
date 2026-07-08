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
  FinanceField,
  FinanceMappingCandidate,
  CompanySearchResult,
  FieldConfidence,
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
  const streetName =
    pickRawString(raw, ["Street", "StreetName", "Ulica", "Address", "AddressLine1"]) ?? "";
  const streetNumber =
    pickRawString(raw, ["StreetNumber", "HouseNumber", "OrientationNumber", "CisloDomu"]) ?? "";
  const address = [streetName, streetNumber].filter(Boolean).join(" ").trim();
  const zip = pickRawString(raw, ["ZipCode", "Zip", "PostalCode", "PSC"]) ?? "";
  const cityName = pickRawString(raw, ["City", "Municipality", "Town", "Obec"]) ?? "";
  const city = [zip, cityName].filter(Boolean).join(" ").trim();
  return { address: address || "—", city: city || "—" };
}

// ---------- Raw field helpers (defensive aliases) ----------

/** Read the first non-empty string across a list of aliased keys, case-insensitive. */
function pickRawString(raw: FinstatRawCompany, keys: string[]): string | undefined {
  const bag = raw as Record<string, unknown>;
  for (const k of keys) {
    const s = nonEmptyString(bag[k]);
    if (s) return s;
    // Case-insensitive fallback (Finstat has mixed-case variants).
    const lower = k.toLowerCase();
    for (const rawKey of Object.keys(bag)) {
      if (rawKey.toLowerCase() === lower) {
        const v = nonEmptyString(bag[rawKey]);
        if (v) return v;
      }
    }
  }
  return undefined;
}

function pickRawNumber(raw: FinstatRawCompany, keys: string[]): number | undefined {
  const bag = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = bag[k];
    if (v == null || v === "") continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function isUsableFinancialAmount(n: number, hasPeriod: boolean): boolean {
  if (!Number.isFinite(n)) return false;
  if (!hasPeriod && (n === 0 || n === 1)) return false;
  return true;
}

function readFinancialPeriod(raw: FinstatRawCompany): string | undefined {
  return (
    pickRawString(raw, [
      "FinancialsYear",
      "YearOfSales",
      "YearOfProfit",
      "Year",
      "Period",
      "AccountingPeriod",
      "FinancialPeriod",
    ]) ??
    (() => {
      const n = pickRawNumber(raw, ["FinancialsYear", "YearOfSales", "YearOfProfit", "Year"]);
      return n != null ? String(n) : undefined;
    })()
  );
}

function previewFinancialValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return previewValue(value);
}

const FINSTAT_TOP_LEVEL_FINANCIAL_FIELDS: Array<{ key: string; field: FinanceField }> = [
  { key: "Sales", field: "revenue" },
  { key: "Revenue", field: "revenue" },
  { key: "RevenueActual", field: "revenue" },
  { key: "Profit", field: "profit" },
  { key: "ProfitActual", field: "profit" },
  { key: "Assets", field: "assets" },
  { key: "AssetsActual", field: "assets" },
  { key: "Liabilities", field: "liabilities" },
  { key: "LiabilitiesActual", field: "liabilities" },
];

export function buildFinstatFinanceCandidates(raw: FinstatRawCompany): FinanceMappingCandidate[] {
  const bag = raw as Record<string, unknown>;
  const period = readFinancialPeriod(raw);
  const hasPeriod = !!period;
  const out: FinanceMappingCandidate[] = [];

  for (const { key, field } of FINSTAT_TOP_LEVEL_FINANCIAL_FIELDS) {
    const rawValue = bag[key];
    if (rawValue == null || rawValue === "") continue;
    const numeric = typeof rawValue === "number" ? rawValue : Number(rawValue);
    const isRawRevenueProfit = key === "Revenue" || key === "Profit";
    let reason: string;
    if (!Number.isFinite(numeric)) {
      reason = "rejected: value is not numeric";
    } else if (isRawRevenueProfit && !hasPeriod) {
      reason = "rejected: raw Revenue/Profit has no confirmed financial period";
    } else if (!isUsableFinancialAmount(numeric, hasPeriod)) {
      reason = "rejected: 0/1 without a confirmed period is suspicious";
    } else if (!hasPeriod) {
      reason = "rejected: numeric financial amount has no confirmed period";
    } else {
      reason = "accepted: numeric amount has an attached period";
    }
    out.push({
      source: "finstat",
      field,
      rawField: key,
      rawValuePreview: previewFinancialValue(rawValue),
      period,
      selected: false,
      reason,
    });
  }

  for (const r of raw.Financials ?? []) {
    if (typeof r.Year !== "number") continue;
    for (const [rawField, field, rawValue] of [
      ["Financials[].Sales", "revenue", r.Sales],
      ["Financials[].Profit", "profit", r.Profit],
      ["Financials[].Assets", "assets", r.Assets],
      ["Financials[].Liabilities", "liabilities", r.Liabilities],
    ] as const) {
      if (rawValue == null) continue;
      out.push({
        source: "finstat",
        field,
        rawField,
        rawValuePreview: previewFinancialValue(rawValue),
        period: String(r.Year),
        selected: false,
        reason: Number.isFinite(Number(rawValue))
          ? "accepted: Financials[] row has a year"
          : "rejected: value is not numeric",
      });
    }
  }

  return out;
}

/** Real company website — never a Finstat profile URL. */
function pickWebsite(raw: FinstatRawCompany): string | undefined {
  const bag = raw as Record<string, unknown>;
  // Explicit dedicated website fields only.
  const candidates = [
    "Website",
    "WebSite",
    "HomePage",
    "Homepage",
    "Web",
    "WebPage",
    "CompanyWebsite",
    "WebUrl",
  ];
  for (const key of candidates) {
    const s = nonEmptyString(bag[key]);
    if (s && !isFinstatProfileUrl(s)) return s;
  }
  return undefined;
}

function isFinstatProfileUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "finstat.sk" || host.endsWith(".finstat.sk");
  } catch {
    return /finstat\.sk/i.test(url);
  }
}


// ---------- Defensive VAT resolution ----------

export interface VatCandidate {
  field: string;
  rawValue: string | number | boolean | null;
  normalized: boolean | null;
  confidence: FieldConfidence;
}

export interface VatResolution {
  value?: boolean;
  confidence: FieldConfidence;
  chosen?: VatCandidate;
  candidates: VatCandidate[];
}

function nonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function parseBoolLike(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "y", "ano", "áno"].includes(s)) return true;
    if (["false", "0", "no", "n", "nie"].includes(s)) return false;
  }
  return null;
}

/**
 * Resolve VAT-payer status from a raw Finstat payload defensively.
 *
 * Rules:
 * - Explicit IC DPH string ⇒ confirmed payer.
 * - Explicit ReliableVatPayer / UnreliableVatPayer boolean ⇒ confirmed payer.
 * - Explicit VatPayer / VatRegistration / Dph boolean ⇒ confirmed.
 * - Otherwise ⇒ unknown (renders as "Nedostupné"). Never guess "Nie".
 */
export function resolveVatStatus(raw: FinstatRawCompany): VatResolution {
  const candidates: VatCandidate[] = [];

  const icdph = nonEmptyString(raw.IcDph) ?? nonEmptyString(raw.IcDPH) ?? nonEmptyString(raw.Icdph);
  if (raw.IcDph !== undefined || raw.IcDPH !== undefined || raw.Icdph !== undefined) {
    candidates.push({
      field: "IcDph",
      rawValue: (raw.IcDph ?? raw.IcDPH ?? raw.Icdph ?? null) as string | null,
      normalized: icdph ? true : null,
      confidence: icdph ? "confirmed" : "unknown",
    });
  }

  if (raw.ReliableVatPayer != null) {
    candidates.push({
      field: "ReliableVatPayer",
      rawValue: raw.ReliableVatPayer,
      normalized: raw.ReliableVatPayer === true ? true : null,
      confidence: raw.ReliableVatPayer === true ? "confirmed" : "unknown",
    });
  }
  if (raw.UnreliableVatPayer != null) {
    // Unreliable = still a payer, just flagged as unreliable.
    candidates.push({
      field: "UnreliableVatPayer",
      rawValue: raw.UnreliableVatPayer,
      normalized: raw.UnreliableVatPayer === true ? true : null,
      confidence: raw.UnreliableVatPayer === true ? "confirmed" : "unknown",
    });
  }

  for (const field of ["VatPayer", "VatRegistration", "Dph"] as const) {
    const v = raw[field];
    if (v == null) continue;
    const parsed = parseBoolLike(v);
    candidates.push({
      field,
      rawValue: (typeof v === "string" || typeof v === "boolean" || typeof v === "number") ? v : null,
      normalized: parsed,
      // Only true confirms payer status. False without ICDPH does not disprove it.
      confidence: parsed === true ? "confirmed" : "unknown",
    });
  }

  if (raw.TaxReliability != null) {
    const s = nonEmptyString(raw.TaxReliability);
    candidates.push({
      field: "TaxReliability",
      rawValue: s,
      normalized: null,
      confidence: "inferred",
    });
  }

  const confirmedTrue = candidates.find((c) => c.confidence === "confirmed" && c.normalized === true);
  if (confirmedTrue) {
    return { value: true, confidence: "confirmed", chosen: confirmedTrue, candidates };
  }
  // No explicit confirmation ⇒ unknown (never infer "Nie").
  return { value: undefined, confidence: "unknown", candidates };
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
  const vat = resolveVatStatus(raw);
  const bag = raw as Record<string, unknown>;

  const legalForm =
    pickRawString(raw, ["LegalFormText", "LegalForm", "legalForm", "LegalFormName"]) ??
    pickRawString(raw, ["LegalFormCode"]) ??
    "—";

  const skNaceCode = pickRawString(raw, [
    "SkNaceCode",
    "SKNaceCode",
    "NaceCode",
    "SkNACECode",
  ]) ?? (typeof raw.SkNace?.Code === "string" ? raw.SkNace.Code : undefined);

  const skNaceText = pickRawString(raw, [
    "SkNaceText",
    "SKNaceText",
    "NaceText",
    "NaceDescription",
    "SkNaceName",
  ]) ?? (typeof raw.SkNace?.Name === "string" ? raw.SkNace.Name : undefined);

  // Industry: prefer SK NACE text; fall back to Activity/Sector; last resort — the NACE code alone.
  const industry =
    skNaceText ??
    pickRawString(raw, ["Activity", "Sector", "MainActivity", "Industry"]) ??
    skNaceCode ??
    undefined;

  const employees =
    pickRawNumber(raw, ["EmployeeCount", "Employees", "NumberOfEmployees", "EmployeesCount"]);

  const website = pickWebsite(raw);

  const registrationDate =
    pickRawString(raw, ["Created", "RegistrationDate", "EstablishedOn", "DateOfEstablishment"]) ?? "";

  const registrationNumberText = pickRawString(raw, [
    "RegisterNumberText",
    "RegistrationNumber",
    "RegisterNumber",
    "RegistrationNumberText",
  ]);

  return {
    ico: String(raw.Ico ?? bag.ICO ?? bag.ico ?? ""),
    dic: pickRawString(raw, ["Dic", "DIC", "TaxNumber"]) ?? undefined,
    icDph: nonEmptyString(raw.IcDph) ?? nonEmptyString(raw.IcDPH) ?? nonEmptyString(raw.Icdph) ?? undefined,
    name: pickRawString(raw, ["Name", "CompanyName", "FullName"]) ?? "Neznáma firma",
    legalForm,
    address,
    city,
    registrationDate,
    vatPayer: vat.value,
    vatPayerConfidence: vat.confidence,
    revenue: latestFin?.revenue ?? 0,
    profit: latestFin?.profit ?? 0,
    riskScore: score,
    riskLevel: riskLevelFromScore(score),
    employees,
    industry,
    website,
    registrationNumberText,
    skNaceCode,
    skNaceText,
    latestAssets: latestFin?.assets,
    latestLiabilities: latestFin?.liabilities,
    latestFinancialsYear: latestFin?.year,
    latestFinancialsSource: latestFin ? "finstat" : undefined,
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

// ---------- Dev-only raw field inspector ----------

/** Field keys we intentionally consume from a Finstat detail response. */
export const FINSTAT_MAPPED_FIELDS: Record<string, string> = {
  Ico: "ico",
  ICO: "ico",
  Dic: "dic",
  DIC: "dic",
  TaxNumber: "dic",
  IcDph: "icDph",
  IcDPH: "icDph",
  Icdph: "icDph",
  Name: "name",
  CompanyName: "name",
  FullName: "name",
  LegalForm: "legalForm",
  LegalFormText: "legalForm",
  LegalFormCode: "legalForm",
  LegalFormName: "legalForm",
  legalForm: "legalForm",
  Street: "address",
  StreetName: "address",
  StreetNumber: "address",
  HouseNumber: "address",
  OrientationNumber: "address",
  Ulica: "address",
  Address: "address",
  AddressLine1: "address",
  CisloDomu: "address",
  City: "city",
  Municipality: "city",
  Town: "city",
  Obec: "city",
  ZipCode: "city",
  Zip: "city",
  PostalCode: "city",
  PSC: "city",
  Region: "city",
  Created: "registrationDate",
  RegistrationDate: "registrationDate",
  EstablishedOn: "registrationDate",
  DateOfEstablishment: "registrationDate",
  RegisterNumberText: "registrationNumberText",
  RegistrationNumber: "registrationNumberText",
  RegisterNumber: "registrationNumberText",
  RegistrationNumberText: "registrationNumberText",
  EmployeeCount: "employees",
  Employees: "employees",
  NumberOfEmployees: "employees",
  EmployeesCount: "employees",
  SkNace: "skNaceCode/skNaceText",
  SkNaceCode: "skNaceCode",
  SKNaceCode: "skNaceCode",
  NaceCode: "skNaceCode",
  SkNACECode: "skNaceCode",
  SkNaceText: "skNaceText",
  SKNaceText: "skNaceText",
  NaceText: "skNaceText",
  NaceDescription: "skNaceText",
  SkNaceName: "skNaceText",
  Activity: "industry",
  Sector: "industry",
  MainActivity: "industry",
  Industry: "industry",
  Website: "website",
  WebSite: "website",
  HomePage: "website",
  Homepage: "website",
  Web: "website",
  WebPage: "website",
  CompanyWebsite: "website",
  WebUrl: "website",
  Url: "(ignored — Finstat profile URL, not company website)",
  Sales: "revenue",
  Revenue: "(ignored unless tied to a confirmed financial period)",
  RevenueActual: "revenue candidate (requires confirmed period)",
  Profit: "(ignored unless tied to a confirmed financial period)",
  ProfitActual: "profit candidate (requires confirmed period)",
  Assets: "latestAssets",
  Liabilities: "latestLiabilities",
  ReliableVatPayer: "vatPayer",
  UnreliableVatPayer: "vatPayer (reliability flag)",
  VatPayer: "vatPayer",
  VatRegistration: "vatPayer",
  Dph: "vatPayer",
  TaxReliability: "vatPayer (weak signal)",
  Financials: "financials[]",
  Persons: "people[]",
  Owners: "people[]",
  KUVs: "people[]",
  Warnings: "warnings",
  Warning: "warnings",
  PaymentOrder: "paymentOrderWarnings",
  PaymentOrders: "paymentOrderWarnings",
  PaymentOrderInfo: "paymentOrderWarnings",
  TaxDebt: "debtIndicators.taxDebt",
  JudicialDebt: "debtIndicators.judicialDebt",
  SocialInsuranceDebt: "debtIndicators.socialDebt",
  HealthInsuranceDebt: "debtIndicators.healthDebt",
  BankruptcyInfo: "risks.insolvency",
  DistrainmentsInfo: "risks.executions",
  Cancelled: "(not mapped)",
};

export interface FinstatRawFieldRow {
  key: string;
  valuePreview: string;
  mapped: boolean;
  target?: string;
}

export function buildFinstatRawInspector(raw: FinstatRawCompany): FinstatRawFieldRow[] {
  const rows: FinstatRawFieldRow[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const target = FINSTAT_MAPPED_FIELDS[key];
    rows.push({
      key,
      valuePreview: previewValue(value),
      mapped: Boolean(target) && !target?.startsWith("("),
      target,
    });
  }
  rows.sort((a, b) => {
    if (a.mapped !== b.mapped) return a.mapped ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
  return rows;
}

function previewValue(v: unknown): string {
  if (v == null) return "null";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const j = JSON.stringify(v);
    return j.length > 120 ? `${j.slice(0, 120)}…` : j;
  } catch {
    return "[unserializable]";
  }
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
    .map((r) => {
      const year = r.Year as number;
      return {
        year,
        revenue: Number(r.Sales ?? 0),
        profit: Number(r.Profit ?? 0),
        ebitda: Number(r.Ebitda ?? 0),
        assets: Number(r.Assets ?? 0),
        liabilities: Number(r.Liabilities ?? 0),
        source: "finstat" as const,
        availableFields: ([
          ["revenue", r.Sales],
          ["profit", r.Profit],
          ["assets", r.Assets],
          ["liabilities", r.Liabilities],
        ] as const)
          .filter(([, value]) => value !== undefined && Number.isFinite(Number(value)))
          .map(([field]) => field),
      };
    })
    .filter((r) =>
      [r.revenue, r.profit, r.assets, r.liabilities].some((value) => isUsableFinancialAmount(value, true)),
    )
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
    (() => {
      const vat = resolveVatStatus(raw);
      let detail: string;
      if (unreliable) detail = "Nespoľahlivý platiteľ DPH";
      else if (vat.confidence === "confirmed" && vat.value === true) detail = "Spoľahlivý platiteľ";
      else detail = "Stav DPH nedostupný";
      return {
        key: "vat_reliability" as const,
        label: "Spoľahlivosť platiteľa DPH",
        status: (unreliable ? "warning" : "clear") as "warning" | "clear",
        detail,
      };
    })(),
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
