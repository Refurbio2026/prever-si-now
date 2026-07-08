// RÚZ (Register účtovných závierok) provider.
// Public API — no authentication, no secrets. Two-step fetch:
//   1) /uctovne-jednotky?ico=<ico> → accounting entity id(s)
//   2) /uctovna-jednotka?id=<id>   → entity + idUctovnychZavierok[]
//   3) /uctovna-zavierka?id=<id>   → per-statement metadata
// We cap fan-out to the N most recent statements to keep latency bounded.

import type { AccountingStatement } from "@/lib/types";
import { empty, ok, unavailable, type ProviderResult } from "./base.server";
import type { ProviderDiagnostic } from "./types";

const RUZ_BASE = "https://www.registeruz.sk/cruz-public/api";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_STATEMENTS = 12;
const ALLOW_MOCK = process.env.NODE_ENV !== "production";

interface RuzUnitList {
  id?: number[];
}
interface RuzUnit {
  id?: number;
  ico?: string;
  idUctovnychZavierok?: number[];
}
interface RuzStatement {
  id?: number;
  typ?: string;
  konsolidovana?: boolean;
  obdobieOd?: string;
  obdobieDo?: string;
  datumPodania?: string;
  datumZostavenia?: string;
  datumSchvalenia?: string;
  datumZostaveniaK?: string;
}

class RuzError extends Error {
  code: "network_error" | "http_error" | "not_found" | "parse_error";
  status?: number;
  endpoint?: string;
  rawResponse?: string;
  constructor(
    code: RuzError["code"],
    message: string,
    extra?: { status?: number; endpoint?: string; rawResponse?: string },
  ) {
    super(message);
    this.name = "RuzError";
    this.code = code;
    this.status = extra?.status;
    this.endpoint = extra?.endpoint;
    this.rawResponse = extra?.rawResponse;
  }
}

async function ruzFetch<T>(path: string): Promise<T> {
  const url = `${RUZ_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      throw new RuzError("http_error", `RÚZ ${res.status}`, {
        status: res.status,
        endpoint: path,
        rawResponse: body.slice(0, 500),
      });
    }
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new RuzError("parse_error", "Invalid JSON from RÚZ", {
        endpoint: path,
        rawResponse: body.slice(0, 500),
      });
    }
  } catch (err) {
    if (err instanceof RuzError) throw err;
    throw new RuzError("network_error", (err as Error).message ?? "network error", {
      endpoint: path,
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeStatement(raw: RuzStatement): AccountingStatement | null {
  if (raw.id == null) return null;
  const yearSrc =
    raw.datumZostaveniaK ?? raw.obdobieDo ?? raw.datumZostavenia ?? raw.datumPodania;
  const yearMatch = yearSrc?.match(/^(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
  return {
    id: String(raw.id),
    year,
    type: raw.typ?.trim() || "Neznámy typ",
    periodFrom: raw.obdobieOd,
    periodTo: raw.obdobieDo,
    submittedAt: raw.datumPodania,
    preparedAt: raw.datumZostavenia,
    approvedAt: raw.datumSchvalenia,
    consolidated: raw.konsolidovana,
    detailUrl: `https://www.registeruz.sk/cruz-public/domain/accountingentity/show/${raw.id}`,
  };
}

// Mock data removed — RÚZ never returns placeholder statements.


export async function ruzStatements(
  ico: string,
  diagnostics?: ProviderDiagnostic[],
): Promise<ProviderResult<AccountingStatement[]>> {
  try {
    const list = await ruzFetch<RuzUnitList>(
      `/uctovne-jednotky?zmenene-od=1900-01-01&ico=${encodeURIComponent(ico)}`,
    );
    const unitId = list.id?.[0];
    if (unitId == null) {
      return empty("ruz", "statements", [], "V RÚZ neexistuje žiadna účtovná jednotka.");
    }

    const unit = await ruzFetch<RuzUnit>(`/uctovna-jednotka?id=${unitId}`);
    const ids = (unit.idUctovnychZavierok ?? []).slice(0, MAX_STATEMENTS);
    if (ids.length === 0) {
      return empty("ruz", "statements", [], "V RÚZ neboli nájdené žiadne účtovné závierky.");
    }

    const settled = await Promise.allSettled(
      ids.map((id) => ruzFetch<RuzStatement>(`/uctovna-zavierka?id=${id}`)),
    );

    const statements: AccountingStatement[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled") {
        const norm = normalizeStatement(s.value);
        if (norm) statements.push(norm);
      }
    }

    // Newest first.
    statements.sort((a, b) => b.year - a.year);

    if (statements.length === 0) {
      return empty("ruz", "statements", [], "RÚZ nevrátil žiadne platné závierky.");
    }
    return ok("ruz", "statements", statements);
  } catch (err) {
    const e = err as RuzError;
    diagnostics?.push({
      source: "ruz",
      capability: "statements",
      endpoint: e.endpoint,
      httpStatus: e.status,
      errorCode: e.code ?? "unknown",
      rawError: e.rawResponse,
      normalizedError: e.message,
    });
    // No mock fallback — empty list means "Nedostupné" in the UI.
    return unavailable(
      "ruz",
      "statements",
      [],
      "error",
      e.message ?? "Chyba pri komunikácii s RÚZ.",
    );
  }
}
