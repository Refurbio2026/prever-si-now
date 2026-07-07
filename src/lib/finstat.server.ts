// Server-only Finstat client + response normalization.
// Never import this file from client-reachable modules directly.
// Access it from a createServerFn handler via `await import(...)`.

import { createHash } from "crypto";

import type {
  Company,
  CompanyPerson,
  FinancialYear,
  FinstatRawCompany,
  FinstatSearchHit,
  RiskIndicator,
  RiskLevel,
} from "./types";

const FINSTAT_BASE = "https://www.finstat.sk/api";
const STATION_ID = "preversi-sk";
const STATION_NAME = "PreverSi.sk";

export class FinstatError extends Error {
  code:
    | "missing_query"
    | "missing_credentials"
    | "not_found"
    | "rate_limit"
    | "unauthorized"
    | "server_error"
    | "network_error";
  constructor(code: FinstatError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "FinstatError";
  }
}

function credentials() {
  const apiKey = process.env.FINSTAT_API_KEY;
  const privateKey = process.env.FINSTAT_PRIVATE_KEY;
  if (!apiKey || !privateKey) {
    throw new FinstatError(
      "missing_credentials",
      "Finstat API credentials are not configured on the server.",
    );
  }
  return { apiKey, privateKey };
}

// Finstat hash: sha256 of "<ApiKey>+<PrivateKey>+<value>" (hex).
// Ref: https://www.finstat.sk/api/dokumentacia
function computeHash(value: string): string {
  const { apiKey, privateKey } = credentials();
  return createHash("sha256")
    .update(`${apiKey}+${privateKey}+${value}`)
    .digest("hex");
}

export function looksLikeIco(query: string): boolean {
  return /^\d{6,8}$/.test(query.trim());
}

function mapStatusFromResponse(status: number): FinstatError {
  if (status === 401 || status === 403) {
    return new FinstatError("unauthorized", "Invalid Finstat API credentials.");
  }
  if (status === 404) return new FinstatError("not_found", "Company not found.");
  if (status === 429) return new FinstatError("rate_limit", "Finstat rate limit reached.");
  return new FinstatError("server_error", `Finstat responded with HTTP ${status}.`);
}

async function finstatFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const { apiKey } = credentials();
  const body = new URLSearchParams({
    apiKey,
    StationId: STATION_ID,
    StationName: STATION_NAME,
    Json: "1",
    ...params,
  });
  let res: Response;
  try {
    res = await fetch(`${FINSTAT_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
  } catch (err) {
    throw new FinstatError(
      "network_error",
      `Network error contacting Finstat: ${(err as Error).message}`,
    );
  }
  if (!res.ok) throw mapStatusFromResponse(res.status);
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new FinstatError("server_error", "Finstat returned a non-JSON response.");
  }
}

export async function finstatSearchByName(query: string): Promise<FinstatSearchHit[]> {
  const hash = computeHash(query);
  const data = (await finstatFetch("/autocomplete-ext", { Query: query, Hash: hash })) as
    | { Results?: FinstatSearchHit[] }
    | FinstatSearchHit[]
    | null;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.Results ?? [];
}

export async function finstatGetByIco(ico: string): Promise<FinstatRawCompany> {
  const hash = computeHash(ico);
  const data = (await finstatFetch("/detail", { Ico: ico, Hash: hash })) as FinstatRawCompany | null;
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
    revenue: Number(raw.Sales ?? 0),
    profit: Number(raw.Profit ?? 0),
    riskScore: score,
    riskLevel: riskLevelFromScore(score),
    employees: raw.EmployeeCount ? Number(raw.EmployeeCount) : undefined,
    industry: raw.SkNace?.Name || raw.Activity || undefined,
    website: raw.Url || undefined,
  };
}

export function normalizeSearchHit(hit: FinstatSearchHit): Company {
  return {
    ico: String(hit.Ico ?? ""),
    name: hit.Name ?? "Neznáma firma",
    legalForm: "—",
    address: hit.Street ?? "—",
    city: [hit.ZipCode, hit.City].filter(Boolean).join(" ") || "—",
    registrationDate: "",
    vatPayer: false,
    revenue: 0,
    profit: 0,
    riskScore: 0,
    riskLevel: "medium",
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
