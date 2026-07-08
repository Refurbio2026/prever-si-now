// RPVS (Register partnerov verejného sektora) provider.
// Uses the public OData feed at rpvs.gov.sk/OpenData — no auth, no secrets.
// A single request returns the partner record plus its expanded beneficial
// owners (KonecniUzivateliaVyhod) and authorized persons (OpravneneOsoby).

import type { CompanyPerson } from "@/lib/types";
import { empty, ok, unavailable, type ProviderResult } from "./base.server";
import type { ProviderDiagnostic } from "./types";

const RPVS_BASE = "https://rpvs.gov.sk/OpenData";
const REQUEST_TIMEOUT_MS = 8000;

/** Serializable, UI-safe summary of an authorized person (oprávnená osoba). */
export interface RpvsAuthorizedPerson {
  name: string;
  ico?: string;
  address?: string;
  validFrom?: string;
  validTo?: string;
}

/** Full RPVS bundle returned by the provider. */
export interface RpvsBundle {
  /** Present when the company has (or had) a RPVS record. */
  status: "aktívny" | "neaktívny" | "nezaregistrovaný";
  registrationDate?: string;
  authorizedPerson?: RpvsAuthorizedPerson;
  beneficialOwners: CompanyPerson[];
}

class RpvsError extends Error {
  code: "network_error" | "http_error" | "not_found" | "parse_error" | "timeout";
  status?: number;
  endpoint?: string;
  rawResponse?: string;
  constructor(
    code: RpvsError["code"],
    message: string,
    extra?: { status?: number; endpoint?: string; rawResponse?: string },
  ) {
    super(message);
    this.name = "RpvsError";
    this.code = code;
    this.status = extra?.status;
    this.endpoint = extra?.endpoint;
    this.rawResponse = extra?.rawResponse;
  }
}

async function rpvsFetch(path: string): Promise<{ json: unknown; raw: string }> {
  const url = `${RPVS_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new RpvsError("http_error", `RPVS ${res.status}`, {
        status: res.status,
        endpoint: path,
        rawResponse: raw.slice(0, 500),
      });
    }
    try {
      return { json: JSON.parse(raw) as unknown, raw };
    } catch {
      throw new RpvsError("parse_error", "Invalid JSON from RPVS", {
        endpoint: path,
        rawResponse: raw.slice(0, 500),
      });
    }
  } catch (err) {
    if (err instanceof RpvsError) throw err;
    const isAbort = (err as { name?: string })?.name === "AbortError";
    throw new RpvsError(
      isAbort ? "timeout" : "network_error",
      (err as Error).message ?? "RPVS network error",
      { endpoint: path },
    );
  } finally {
    clearTimeout(timer);
  }
}

// ----- defensive picks -----

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}
function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function normalizeAddress(addr: unknown): string | undefined {
  const r = asRecord(addr);
  if (!r) return asString(addr);
  const preformatted =
    asString(r.FormatovanaAdresa) ??
    asString(r.formatedAddress) ??
    asString(r.FormattedAddress);
  if (preformatted) return preformatted;
  const street = asString(r.Ulica) ?? asString(r.street);
  const number = asString(r.OrientacneCislo) ?? asString(r.SupisneCislo);
  const zip = asString(r.Psc) ?? asString(r.postalCode);
  const city = asString(r.Mesto) ?? asString(r.Obec) ?? asString(r.city);
  const line = [street, number].filter(Boolean).join(" ");
  const cityLine = [zip, city].filter(Boolean).join(" ");
  const combined = [line, cityLine].filter(Boolean).join(", ");
  return combined || undefined;
}

function personName(r: Record<string, unknown>): string | undefined {
  const full = asString(r.FullName) ?? asString(r.MenoPriezvisko) ?? asString(r.Nazov);
  if (full) return full;
  const title = asString(r.Titul) ?? asString(r.TitulPred);
  const first = asString(r.Meno) ?? asString(r.MenoOsoby);
  const last = asString(r.Priezvisko);
  const titleAfter = asString(r.TitulZa);
  const composed = [title, first, last, titleAfter].filter(Boolean).join(" ").trim();
  return composed || undefined;
}

function isCurrentlyValid(r: Record<string, unknown>): boolean {
  const to = asString(r.PlatnostDo) ?? asString(r.DatumUkoncenia) ?? asString(r.validTo);
  return !to;
}

function extractBeneficialOwners(list: unknown): CompanyPerson[] {
  const arr = asArray(list);
  const out: CompanyPerson[] = [];
  for (const entry of arr) {
    const r = asRecord(entry);
    if (!r) continue;
    if (!isCurrentlyValid(r)) continue;
    const name = personName(r);
    if (!name) continue;
    const since =
      asString(r.PlatnostOd) ?? asString(r.DatumZapisu) ?? asString(r.validFrom) ?? "";
    const address = normalizeAddress(r.Adresa ?? r.address);
    out.push({ name, role: "beneficial_owner", since, address });
  }
  return out;
}

function extractAuthorizedPerson(list: unknown): RpvsAuthorizedPerson | undefined {
  const arr = asArray(list);
  // Prefer a currently valid record; fall back to the first entry.
  const current = arr.find((e) => {
    const r = asRecord(e);
    return r ? isCurrentlyValid(r) : false;
  });
  const pick = asRecord(current ?? arr[0]);
  if (!pick) return undefined;
  const name =
    asString(pick.ObchodneMeno) ??
    asString(pick.Nazov) ??
    personName(pick);
  if (!name) return undefined;
  return {
    name,
    ico: asString(pick.Ico),
    address: normalizeAddress(pick.Adresa ?? pick.address),
    validFrom: asString(pick.PlatnostOd) ?? asString(pick.DatumZapisu),
    validTo: asString(pick.PlatnostDo) ?? asString(pick.DatumUkoncenia),
  };
}

function normalizePartner(record: Record<string, unknown>): RpvsBundle {
  const beneficialOwners = extractBeneficialOwners(
    record.KonecniUzivateliaVyhod ?? record.BeneficialOwners,
  );
  const authorizedPerson = extractAuthorizedPerson(
    record.OpravneneOsoby ?? record.AuthorizedPersons,
  );
  const registrationDate =
    asString(record.DatumZapisu) ?? asString(record.PlatnostOd);
  const terminatedOn =
    asString(record.DatumVymazu) ?? asString(record.PlatnostDo);
  const status: RpvsBundle["status"] = terminatedOn ? "neaktívny" : "aktívny";
  return {
    status,
    registrationDate,
    authorizedPerson,
    beneficialOwners,
  };
}

/**
 * Fetch RPVS data for a given IČO. Never throws — failures are returned as
 * `unavailable` results with a diagnostic entry, so upstream aggregation
 * can continue rendering Finstat / ORSR / RÚZ data.
 */
export async function rpvsPartnerBundle(
  ico: string,
  diagnostics?: ProviderDiagnostic[],
): Promise<ProviderResult<RpvsBundle | undefined>> {
  const endpoint = `/Partneri?$filter=${encodeURIComponent(
    `Ico eq '${ico}'`,
  )}&$expand=KonecniUzivateliaVyhod,OpravneneOsoby`;
  try {
    const { json } = await rpvsFetch(endpoint);
    const root = asRecord(json);
    const values = asArray(root?.value ?? root?.results);
    const first = asRecord(values[0]);
    if (!first) {
      return empty<RpvsBundle | undefined>(
        "rpvs",
        "people",
        {
          status: "nezaregistrovaný",
          beneficialOwners: [],
        },
        "Firma nie je zapísaná v RPVS.",
      );
    }
    const bundle = normalizePartner(first);
    return ok<RpvsBundle | undefined>("rpvs", "people", bundle);
  } catch (err) {
    const e = err as RpvsError;
    diagnostics?.push({
      source: "rpvs",
      capability: "people",
      endpoint: e.endpoint ?? endpoint,
      httpStatus: e.status,
      errorCode: e.code ?? "unknown",
      rawError: e.rawResponse,
      normalizedError: e.message,
    });
    return unavailable<RpvsBundle | undefined>(
      "rpvs",
      "people",
      undefined,
      "unavailable",
      e.message ?? "Chyba pri komunikácii s RPVS.",
    );
  }
}
