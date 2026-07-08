// CRZ (Centrálny register zmlúv) provider.
// Fetches public contracts filed with CRZ for a given IČO from the official
// public search page on crz.gov.sk (no auth, no secrets).
//
// Server-side only. Defensive HTML parsing — any failure returns an
// `unavailable` result with a diagnostic so the rest of the profile still
// renders.

import type { PublicContract } from "@/lib/types";
import { empty, ok, unavailable, type ProviderResult } from "./base.server";
import type { ProviderDiagnostic } from "./types";

const CRZ_BASE = "https://www.crz.gov.sk";
// The real, working search endpoint on the modern CRZ portal.
// art_mu=1 searches across supplier or customer IČO.
const SEARCH_PATH = "/2171273-sk/centralny-register-zmluv/";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_ROWS = 50;

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

async function crzFetch(path: string): Promise<{ raw: string; status: number }> {
  const url = `${CRZ_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "sk,en;q=0.8",
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
    return { raw, status: res.status };
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

// ----- defensive HTML parsing tuned to the real CRZ table layout -----
//
// Each row on /2171273-sk/centralny-register-zmluv/ has fixed cells:
//   cell1 = published date (day + Slovak month + year, stacked in spans)
//   cell2 = <a href="/zmluva/{id}/">{title}</a><br/><span>{contractNumber}</span>
//   cell3 = value with currency (e.g. "12&nbsp;345,67&nbsp;€")
//   cell4 = supplier (dodávateľ)
//   cell5 = customer (objednávateľ)

const SK_MONTHS: Readonly<Record<string, string>> = {
  januar: "01",
  februar: "02",
  marec: "03",
  april: "04",
  maj: "05",
  jun: "06",
  jul: "07",
  august: "08",
  september: "09",
  oktober: "10",
  november: "11",
  december: "12",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&euro;/g, "€");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseValue(cell: string): { value?: number; currency?: string } {
  const text = decodeEntities(cell.replace(/<[^>]+>/g, "")).trim();
  if (!text) return {};
  const currency = /€|EUR/i.test(text) ? "EUR" : undefined;
  const cleaned = text
    .replace(/[^\d,.\-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "") // thousands "."
    .replace(",", ".");
  if (!cleaned) return { currency };
  const n = Number(cleaned);
  return { value: Number.isFinite(n) ? n : undefined, currency };
}

function parseDateFromCell(cell: string): string | undefined {
  // Extract stacked spans: day (with trailing "."), month name, year.
  const text = stripTags(cell);
  // Try "19. Marec 2026" pattern first.
  const m = text.match(/(\d{1,2})\.?\s+([A-Za-zÁ-žá-ž]+)\s+(\d{4})/);
  if (m) {
    const day = m[1].padStart(2, "0");
    const monthKey = foldDiacritics(m[2].toLowerCase());
    const month = SK_MONTHS[monthKey];
    if (month) return `${m[3]}-${month}-${day}`;
  }
  // Fallback: dd.MM.yyyy
  const iso = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (iso) {
    return `${iso[3]}-${iso[2].padStart(2, "0")}-${iso[1].padStart(2, "0")}`;
  }
  return undefined;
}

interface RowCells {
  cell1?: string;
  cell2?: string;
  cell3?: string;
  cell4?: string;
  cell5?: string;
}

function extractCells(trInner: string): RowCells {
  const out: RowCells = {};
  const tdRegex = /<td[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = tdRegex.exec(trInner)) !== null) {
    const cls = m[1];
    const inner = m[2];
    if (/\bcell1\b/.test(cls)) out.cell1 = inner;
    else if (/\bcell2\b/.test(cls)) out.cell2 = inner;
    else if (/\bcell3\b/.test(cls)) out.cell3 = inner;
    else if (/\bcell4\b/.test(cls)) out.cell4 = inner;
    else if (/\bcell5\b/.test(cls)) out.cell5 = inner;
  }
  return out;
}

function extractTitleAndNumber(cell2: string): {
  title: string;
  contractNumber?: string;
  href?: string;
} {
  const linkMatch = cell2.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
  const title = linkMatch ? stripTags(linkMatch[2]) : stripTags(cell2);
  const href = linkMatch?.[1];
  const numberMatch = cell2.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
  const contractNumber = numberMatch ? stripTags(numberMatch[1]) || undefined : undefined;
  return { title, contractNumber, href };
}

function parseRows(html: string): PublicContract[] {
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const scope = tbody ? tbody[1] : html;
  const contracts: PublicContract[] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  let idx = 0;
  while ((tr = trRegex.exec(scope)) !== null && contracts.length < MAX_ROWS) {
    const cells = extractCells(tr[1]);
    if (!cells.cell2) continue;
    const { title, contractNumber, href } = extractTitleAndNumber(cells.cell2);
    if (!title) continue;
    const supplierName = cells.cell4 ? stripTags(cells.cell4) || undefined : undefined;
    const customerName = cells.cell5 ? stripTags(cells.cell5) || undefined : undefined;
    const { value, currency } = cells.cell3 ? parseValue(cells.cell3) : {};
    const publishedDate = cells.cell1 ? parseDateFromCell(cells.cell1) : undefined;
    const sourceUrl = href
      ? href.startsWith("http")
        ? href
        : `${CRZ_BASE}${href.startsWith("/") ? "" : "/"}${href}`
      : undefined;
    const idFromHref = href?.match(/\/zmluva\/(\d+)/)?.[1];
    const counterparty = [supplierName, customerName].filter(Boolean).join(" → ");
    contracts.push({
      id: idFromHref ? `crz-${idFromHref}` : `crz-${idx}-${publishedDate ?? ""}`,
      title: title.slice(0, 300),
      counterparty: counterparty || (supplierName ?? customerName ?? ""),
      contractNumber,
      supplierName,
      customerName,
      value,
      currency: currency ?? (value !== undefined ? "EUR" : undefined),
      // CRZ publishes on the same date it lists; we don't have a distinct
      // "signed" date on the search page, so we mirror published into both.
      signedDate: publishedDate,
      signedAt: publishedDate,
      publishedDate,
      sourceUrl,
      url: sourceUrl,
    });
    idx++;
  }
  return contracts;
}

/**
 * Fetch CRZ contracts for a given IČO (as supplier OR customer).
 * Never throws — failures return `unavailable` with a diagnostic entry.
 */
export async function crzContractsByIco(
  ico: string,
  diagnostics?: ProviderDiagnostic[],
): Promise<ProviderResult<PublicContract[]>> {
  const endpoint = `${SEARCH_PATH}?art_mu=1&art_ico=${encodeURIComponent(ico)}`;
  try {
    const { raw, status } = await crzFetch(endpoint);
    let contracts: PublicContract[] = [];
    try {
      contracts = parseRows(raw);
    } catch (parseErr) {
      throw new CrzError("parse_error", (parseErr as Error).message ?? "CRZ parse error", {
        status,
        endpoint,
        rawResponse: raw.slice(0, 500),
      });
    }
    if (contracts.length === 0) {
      return empty<PublicContract[]>(
        "crz",
        "contracts",
        [],
        "Žiadne zmluvy neboli nájdené v CRZ.",
      );
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
