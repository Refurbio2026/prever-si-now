// ÚVO (Úrad pre verejné obstarávanie) provider.
// Fetches public procurement records for a given IČO from the UVO search
// page (no auth). Purely server-side, defensive HTML parsing — any failure
// returns an `unavailable` result with a diagnostic entry.

import type { ProcurementRecord } from "@/lib/types";
import { empty, ok, unavailable, type ProviderResult } from "./base.server";
import type { ProviderDiagnostic } from "./types";

const UVO_BASE = "https://www.uvo.gov.sk";
const REQUEST_TIMEOUT_MS = 8000;

class UvoError extends Error {
  code: "network_error" | "http_error" | "parse_error" | "timeout";
  status?: number;
  endpoint?: string;
  rawResponse?: string;
  constructor(
    code: UvoError["code"],
    message: string,
    extra?: { status?: number; endpoint?: string; rawResponse?: string },
  ) {
    super(message);
    this.name = "UvoError";
    this.code = code;
    this.status = extra?.status;
    this.endpoint = extra?.endpoint;
    this.rawResponse = extra?.rawResponse;
  }
}

async function uvoFetch(path: string): Promise<{ raw: string }> {
  const url = `${UVO_BASE}${path}`;
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
      throw new UvoError("http_error", `UVO ${res.status}`, {
        status: res.status,
        endpoint: path,
        rawResponse: raw.slice(0, 500),
      });
    }
    return { raw };
  } catch (err) {
    if (err instanceof UvoError) throw err;
    const isAbort = (err as { name?: string })?.name === "AbortError";
    throw new UvoError(
      isAbort ? "timeout" : "network_error",
      (err as Error).message ?? "UVO network error",
      { endpoint: path },
    );
  } finally {
    clearTimeout(timer);
  }
}

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
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return undefined;
}

interface RawRow {
  cells: string[];
  detailHref?: string;
}

function extractRows(html: string): RawRow[] {
  const rows: RawRow[] = [];
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const scope = tbodyMatch ? tbodyMatch[1] : html;
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trm: RegExpExecArray | null;
  while ((trm = trRegex.exec(scope)) !== null) {
    const cells: string[] = [];
    let detailHref: string | undefined;
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let td: RegExpExecArray | null;
    while ((td = tdRegex.exec(trm[1])) !== null) {
      const inner = td[1];
      if (!detailHref) {
        const a = inner.match(/href="([^"]+)"/i);
        if (a) detailHref = a[1];
      }
      cells.push(stripTags(inner));
    }
    if (cells.length) rows.push({ cells, detailHref });
  }
  return rows;
}

function normalizeRow(row: RawRow, idx: number): ProcurementRecord | undefined {
  const cells = row.cells;
  if (cells.length === 0) return undefined;
  const dateCell = cells.find((c) => /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(c));
  const valueCell = cells.find(
    (c) => /€|EUR|\d[\d\s\.,]{2,}/.test(c) && parseNumber(c) !== undefined,
  );
  const title =
    cells.filter((c) => c && c !== dateCell && c !== valueCell)
      .sort((a, b) => b.length - a.length)[0] ?? cells[0];
  const counterparty =
    cells.find((c) => c && c !== title && c !== dateCell && c !== valueCell) ?? "";
  const value = valueCell ? parseNumber(valueCell) : undefined;
  const awardDate = dateCell ? parseDate(dateCell) : undefined;
  const url = row.detailHref
    ? row.detailHref.startsWith("http")
      ? row.detailHref
      : `${UVO_BASE}${row.detailHref.startsWith("/") ? "" : "/"}${row.detailHref}`
    : undefined;
  return {
    id: `uvo-${idx}-${awardDate ?? ""}`,
    title: title.slice(0, 300),
    counterparty: counterparty.slice(0, 200),
    buyerName: counterparty.slice(0, 200) || undefined,
    supplierName: undefined,
    value,
    currency: value !== undefined ? "EUR" : undefined,
    procedureType: undefined,
    awardDate,
    signedAt: awardDate,
    sourceUrl: url,
    url,
  };
}

/**
 * Fetch ÚVO procurement records for a given IČO. Never throws.
 */
export async function uvoProcurementByIco(
  ico: string,
  diagnostics?: ProviderDiagnostic[],
): Promise<ProviderResult<ProcurementRecord[]>> {
  const endpoint = `/vyhladavanie/vyhladavanie-zakaziek/?cisloICO=${encodeURIComponent(ico)}`;
  try {
    const { raw } = await uvoFetch(endpoint);
    const rows = extractRows(raw);
    const records: ProcurementRecord[] = [];
    for (let i = 0; i < rows.length && records.length < 50; i++) {
      const r = normalizeRow(rows[i], i);
      if (r && r.title) records.push(r);
    }
    if (records.length === 0) {
      return empty<ProcurementRecord[]>(
        "uvo",
        "contracts",
        [],
        "Žiadne verejné obstarávania neboli nájdené v ÚVO.",
      );
    }
    return ok<ProcurementRecord[]>("uvo", "contracts", records);
  } catch (err) {
    const e = err as UvoError;
    diagnostics?.push({
      source: "uvo",
      capability: "contracts",
      endpoint: e.endpoint ?? endpoint,
      httpStatus: e.status,
      errorCode: e.code ?? "unknown",
      rawError: e.rawResponse,
      normalizedError: e.message,
    });
    return unavailable<ProcurementRecord[]>(
      "uvo",
      "contracts",
      [],
      "error",
      e.message ?? "Chyba pri komunikácii s ÚVO.",
    );
  }
}
