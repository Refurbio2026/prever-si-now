// CRZ (Centrálny register zmlúv) provider.
// Fetches public contracts filed with CRZ for a given supplier or customer IČO.
// Uses the public search page on crz.gov.sk (no auth, no secrets).
// Purely server-side. Defensive HTML parsing — any failure returns an
// `unavailable` result with a diagnostic so the rest of the profile still
// renders.

import type { PublicContract } from "@/lib/types";
import { empty, ok, unavailable, type ProviderResult } from "./base.server";
import type { ProviderDiagnostic } from "./types";

const CRZ_BASE = "https://www.crz.gov.sk";
const REQUEST_TIMEOUT_MS = 8000;

class CrzError extends Error {
  code: "network_error" | "http_error" | "parse_error" | "timeout";
  status?: number;
  endpoint?: string;
  rawResponse?: string;
  constructor(
    code: CrzError["code"],
    message: string,
    extra?: { status?: number; endpoint?: string; rawResponse?: string },
  ) {
    super(message);
    this.name = "CrzError";
    this.code = code;
    this.status = extra?.status;
    this.endpoint = extra?.endpoint;
    this.rawResponse = extra?.rawResponse;
  }
}

async function crzFetch(path: string): Promise<{ raw: string }> {
  const url = `${CRZ_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "PodnikRadarBot/1.0 (+https://podnikradar.sk)",
      },
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new CrzError("http_error", `CRZ ${res.status}`, {
        status: res.status,
        endpoint: path,
        rawResponse: raw.slice(0, 500),
      });
    }
    return { raw };
  } catch (err) {
    if (err instanceof CrzError) throw err;
    const isAbort = (err as { name?: string })?.name === "AbortError";
    throw new CrzError(
      isAbort ? "timeout" : "network_error",
      (err as Error).message ?? "CRZ network error",
      { endpoint: path },
    );
  } finally {
    clearTimeout(timer);
  }
}

// ----- defensive HTML parsing -----

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function parseNumber(v: string): number | undefined {
  const cleaned = v.replace(/[^0-9,.\-]/g, "").replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function parseDate(v: string): string | undefined {
  const s = v.trim();
  if (!s) return undefined;
  // Try dd.MM.yyyy
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return undefined;
}

interface RawRow {
  cells: string[];
  detailHref?: string;
}

function extractRows(html: string): RawRow[] {
  const rows: RawRow[] = [];
  // Grab <tr>...</tr> inside <tbody>
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const scope = tbodyMatch ? tbodyMatch[1] : html;
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trm: RegExpExecArray | null;
  while ((trm = trRegex.exec(scope)) !== null) {
    const trInner = trm[1];
    const cells: string[] = [];
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let td: RegExpExecArray | null;
    let detailHref: string | undefined;
    while ((td = tdRegex.exec(trInner)) !== null) {
      const inner = td[1];
      if (!detailHref) {
        const a = inner.match(/href="([^"]+)"/i);
        if (a) detailHref = a[1];
      }
      cells.push(stripTags(inner));
    }
    if (cells.length > 0) rows.push({ cells, detailHref });
  }
  return rows;
}

function normalizeRow(row: RawRow, idx: number): PublicContract | undefined {
  // CRZ table columns are unstable — pick heuristically.
  // Try to find a title (longest cell), a date, a number, an ICO/party.
  if (row.cells.length === 0) return undefined;
  const cells = row.cells;
  const dateCell = cells.find((c) => /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(c));
  const valueCell = cells.find((c) => /€|EUR|\d[\d\s\.,]{2,}/.test(c) && parseNumber(c) !== undefined);
  const title = cells
    .filter((c) => c && c !== dateCell && c !== valueCell)
    .sort((a, b) => b.length - a.length)[0] ?? cells[0];
  const counterparty = cells.find(
    (c) => c && c !== title && c !== dateCell && c !== valueCell,
  ) ?? "";
  const value = valueCell ? parseNumber(valueCell) : undefined;
  const signedDate = dateCell ? parseDate(dateCell) : undefined;
  const url = row.detailHref
    ? row.detailHref.startsWith("http")
      ? row.detailHref
      : `${CRZ_BASE}${row.detailHref.startsWith("/") ? "" : "/"}${row.detailHref}`
    : undefined;
  return {
    id: `crz-${idx}-${signedDate ?? ""}`,
    title: title.slice(0, 300),
    counterparty: counterparty.slice(0, 200),
    supplierName: counterparty.slice(0, 200) || undefined,
    customerName: undefined,
    contractNumber: undefined,
    value,
    currency: value !== undefined ? "EUR" : undefined,
    signedDate,
    signedAt: signedDate,
    publishedDate: signedDate,
    sourceUrl: url,
    url,
  };
}

/**
 * Fetch CRZ contracts for a given IČO (as supplier OR customer).
 * Never throws — failures return `unavailable` with a diagnostic entry.
 */
export async function crzContractsByIco(
  ico: string,
  diagnostics?: ProviderDiagnostic[],
): Promise<ProviderResult<PublicContract[]>> {
  const endpoint = `/2171273-sk/vyhladavanie-zmluv/?art_ico2=${encodeURIComponent(ico)}&f=1`;
  try {
    const { raw } = await crzFetch(endpoint);
    const rows = extractRows(raw);
    const contracts: PublicContract[] = [];
    for (let i = 0; i < rows.length && contracts.length < 50; i++) {
      const c = normalizeRow(rows[i], i);
      if (c && c.title) contracts.push(c);
    }
    if (contracts.length === 0) {
      return empty<PublicContract[]>("crz", "contracts", [], "Žiadne zmluvy neboli nájdené v CRZ.");
    }
    return ok<PublicContract[]>("crz", "contracts", contracts);
  } catch (err) {
    const e = err as CrzError;
    diagnostics?.push({
      source: "crz",
      capability: "contracts",
      endpoint: e.endpoint ?? endpoint,
      httpStatus: e.status,
      errorCode: e.code ?? "unknown",
      rawError: e.rawResponse,
      normalizedError: e.message,
    });
    return unavailable<PublicContract[]>(
      "crz",
      "contracts",
      [],
      "unavailable",
      e.message ?? "Chyba pri komunikácii s CRZ.",
    );
  }
}
