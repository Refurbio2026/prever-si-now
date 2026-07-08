// ORSR / RPO (Register právnických osôb) provider.
// Uses the free RPO REST API published by Štatistický úrad SR, which
// exposes ORSR-derived registry data in structured JSON — no auth, no
// secrets. Two-step fetch when needed:
//   1) /search?identifiers=<ico> → detail id
//   2) /id/<id>                  → full detail (statutory bodies, etc.)
// Some payloads already include the detail inline in `results[0]`, so we
// only follow the id when statutory bodies are missing.

import type { CompanyPerson } from "@/lib/types";
import { empty, ok, unavailable, type ProviderResult } from "./base.server";
import type { ProviderDiagnostic, RegistryDetails } from "./types";

const RPO_BASE = "https://api.statistics.sk/rpo/v2";
const REQUEST_TIMEOUT_MS = 8000;
const ALLOW_MOCK = process.env.NODE_ENV !== "production";

export type OrsrRegistryDetails = RegistryDetails & { source: "orsr" };


class OrsrError extends Error {
  code: "network_error" | "http_error" | "not_found" | "parse_error" | "timeout";
  status?: number;
  endpoint?: string;
  rawResponse?: string;
  constructor(
    code: OrsrError["code"],
    message: string,
    extra?: { status?: number; endpoint?: string; rawResponse?: string },
  ) {
    super(message);
    this.name = "OrsrError";
    this.code = code;
    this.status = extra?.status;
    this.endpoint = extra?.endpoint;
    this.rawResponse = extra?.rawResponse;
  }
}

async function rpoFetch(path: string): Promise<{ json: unknown; raw: string }> {
  const url = `${RPO_BASE}${path}`;
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
      throw new OrsrError("http_error", `ORSR/RPO ${res.status}`, {
        status: res.status,
        endpoint: path,
        rawResponse: raw.slice(0, 500),
      });
    }
    try {
      return { json: JSON.parse(raw) as unknown, raw };
    } catch {
      throw new OrsrError("parse_error", "Invalid JSON from ORSR/RPO", {
        endpoint: path,
        rawResponse: raw.slice(0, 500),
      });
    }
  } catch (err) {
    if (err instanceof OrsrError) throw err;
    const isAbort = (err as { name?: string })?.name === "AbortError";
    throw new OrsrError(
      isAbort ? "timeout" : "network_error",
      (err as Error).message ?? "ORSR network error",
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

/** Pick a `.value` from the first entry of a `[{ value, validFrom, validTo }]`
 *  array. RPO exposes many fields as time-ranged history arrays. */
function pickCurrentValue(list: unknown): string | undefined {
  const arr = asArray(list);
  if (arr.length === 0) return undefined;
  // Prefer entries with no validTo (currently valid).
  const current = arr.find((e) => {
    const r = asRecord(e);
    return r && (r.validTo == null || r.validTo === "");
  });
  const pick = asRecord(current ?? arr[0]);
  if (!pick) return undefined;
  return asString(pick.value) ?? asString(pick.formatedAddress) ?? asString(pick.formattedAddress);
}

function pickDateFrom(list: unknown): string | undefined {
  const arr = asArray(list);
  if (arr.length === 0) return undefined;
  const first = asRecord(arr[0]);
  return asString(first?.validFrom);
}

function normalizeAddress(entry: unknown): string | undefined {
  const r = asRecord(entry);
  if (!r) return undefined;
  const preformatted =
    asString(r.formatedAddress) ?? asString(r.formattedAddress) ?? asString(r.value);
  if (preformatted) return preformatted;
  const street = asString(r.street);
  const number = asString(r.buildingNumber) ?? asString(r.number);
  const zip = asString(r.postalCode) ?? asString(r.zip);
  const city = asString(r.municipality) ?? asString(r.city);
  const line = [street, number].filter(Boolean).join(" ");
  const cityLine = [zip, city].filter(Boolean).join(" ");
  const combined = [line, cityLine].filter(Boolean).join(", ");
  return combined || undefined;
}

function pickAddress(list: unknown): string | undefined {
  const arr = asArray(list);
  if (arr.length === 0) return undefined;
  const current = arr.find((e) => {
    const r = asRecord(e);
    return r && (r.validTo == null || r.validTo === "");
  });
  return normalizeAddress(current ?? arr[0]);
}

function extractRegistrationNumber(result: Record<string, unknown>): string | undefined {
  const offices = asArray(result.registerOffices ?? result.registrationOffices);
  for (const o of offices) {
    const r = asRecord(o);
    if (!r) continue;
    const reg =
      asRecord(r.registrationNumber)?.value ??
      r.registrationNumber ??
      r.number ??
      r.value;
    const val = asString(reg);
    if (val) return val;
  }
  return asString(result.registrationNumber);
}

function extractStatutoryReps(result: Record<string, unknown>): CompanyPerson[] {
  const bodies = asArray(
    result.statutoryBodies ?? result.statutories ?? result.statutoryOrgans,
  );
  const out: CompanyPerson[] = [];
  for (const b of bodies) {
    const r = asRecord(b);
    if (!r) continue;

    // Skip terminated entries.
    if (asString(r.validTo)) continue;

    const nameCandidates = [
      r.fullName,
      r.name,
      asRecord(r.person)?.fullName,
      asRecord(r.person)?.name,
    ];
    let name: string | undefined;
    for (const c of nameCandidates) {
      name = asString(c);
      if (name) break;
    }
    // Sometimes name is given/family separately.
    if (!name) {
      const p = asRecord(r.person) ?? r;
      const given = asString(p.givenName) ?? asString(p.firstName);
      const family = asString(p.familyName) ?? asString(p.surname) ?? asString(p.lastName);
      const composed = [given, family].filter(Boolean).join(" ").trim();
      if (composed) name = composed;
    }
    if (!name) continue;

    const roleValue =
      asString(asRecord(r.function)?.value) ??
      asString(r.function) ??
      asString(r.role) ??
      "štatutárny orgán";

    const since = asString(r.validFrom) ?? "";
    const address = pickAddress(r.addresses) ?? asString(r.address);

    out.push({
      name,
      role: "executive",
      since,
      address,
    });
  }
  return out;
}

function normalizeRpoResult(result: Record<string, unknown>): OrsrRegistryDetails {
  return {
    source: "orsr",
    registrationNumber: extractRegistrationNumber(result),
    legalForm: pickCurrentValue(result.legalForms),
    registeredAddress: pickAddress(result.addresses),
    registrationDate:
      asString(result.establishment) ??
      asString(result.dateOfEstablishment) ??
      pickDateFrom(result.fullNames),
    status: asString(result.termination)
      ? "Zaniknutá"
      : asString(result.status) ?? "Aktívna",
    statutoryRepresentatives: extractStatutoryReps(result),
  };
}

export async function orsrRegistryDetails(
  ico: string,
  diagnostics?: ProviderDiagnostic[],
): Promise<ProviderResult<OrsrRegistryDetails | undefined>> {
  const endpoint = `/search?identifiers=${encodeURIComponent(ico)}`;
  try {
    const { json } = await rpoFetch(endpoint);
    const root = asRecord(json);
    const results = asArray(root?.results ?? root?.data);
    const first = asRecord(results[0]);
    if (!first) {
      return empty("orsr", "company", undefined, "ORSR nemá záznam pre toto IČO.");
    }

    let details = normalizeRpoResult(first);

    // If statutory bodies weren't inlined but we have an id, follow it up.
    if (details.statutoryRepresentatives.length === 0) {
      const detailId = asString(first.id) ?? asString(first.corporateBodyId);
      if (detailId) {
        try {
          const { json: detailJson } = await rpoFetch(`/id/${encodeURIComponent(detailId)}`);
          const detailRoot = asRecord(detailJson);
          if (detailRoot) details = normalizeRpoResult(detailRoot);
        } catch {
          // ignore — keep partial data
        }
      }
    }

    return ok("orsr", "company", details);
  } catch (err) {
    const e = err as OrsrError;
    diagnostics?.push({
      source: "orsr",
      capability: "company",
      endpoint: e.endpoint ?? endpoint,
      httpStatus: e.status,
      errorCode: e.code ?? "unknown",
      rawError: e.rawResponse,
      normalizedError: e.message,
    });
    // No mock fallback. When ORSR fails, downstream merge falls back to
    // Finstat values (or "Nedostupné" if Finstat also has none).
    return unavailable<OrsrRegistryDetails | undefined>(
      "orsr",
      "company",
      undefined,
      "error",
      e.message ?? "Chyba pri komunikácii s ORSR/RPO.",
    );
  }
}

