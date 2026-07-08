// RÚZ (Register účtovných závierok) provider.
// Public API — no authentication, no secrets. Two-step fetch:
//   1) /uctovne-jednotky?ico=<ico> → accounting entity id(s)
//   2) /uctovna-jednotka?id=<id>   → entity + idUctovnychZavierok[]
//   3) /uctovna-zavierka?id=<id>   → per-statement metadata
// We cap fan-out to the N most recent statements to keep latency bounded.

import type { AccountingStatement, FinanceField, FinanceMappingRuzRow, FinancialYear } from "@/lib/types";
import { empty, ok, unavailable, type ProviderResult } from "./base.server";
import type { ProviderDiagnostic } from "./types";

const RUZ_BASE = "https://www.registeruz.sk/cruz-public/api";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_STATEMENTS = 12;

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
  idUctovnychVykazov?: number[];
}
interface RuzPriloha {
  id?: number;
  meno?: string;
  mimeType?: string;
  velkostPrilohy?: number;
}
interface RuzTabulka {
  nazov?: { sk?: string; en?: string };
  data?: string[];
}
interface RuzVykaz {
  id?: number;
  idUctovnejZavierky?: number;
  prilohy?: RuzPriloha[];
  obsah?: { tabulky?: RuzTabulka[] };
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

const PUBLIC_BASE = "https://www.registeruz.sk/cruz-public";

function attachmentUrl(prilohaId: number): string {
  return `${PUBLIC_BASE}/domain/financialreport/attachment/${prilohaId}`;
}
function reportDetailUrl(vykazId: number): string {
  return `${PUBLIC_BASE}/domain/financialreport/show/${vykazId}`;
}
function reportPdfUrl(vykazId: number): string {
  return `${PUBLIC_BASE}/domain/financialreport/pdf/${vykazId}`;
}

function countNumericCells(vykaz: RuzVykaz | undefined): number {
  if (!vykaz?.obsah?.tabulky) return 0;
  let n = 0;
  for (const t of vykaz.obsah.tabulky) {
    if (!t.data) continue;
    for (const cell of t.data) {
      if (typeof cell === "string" && cell.trim() !== "" && Number.isFinite(Number(cell))) n++;
    }
  }
  return n;
}

function parseNumberCell(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function firstNumeric(data: string[]): number | undefined {
  for (const cell of data) {
    const n = parseNumberCell(cell);
    if (n !== undefined) return n;
  }
  return undefined;
}

function lastCurrentPeriodNumeric(data: string[]): number | undefined {
  for (let i = data.length - 1; i >= 0; i -= 1) {
    if (i % 2 !== 0) continue;
    const n = parseNumberCell(data[i]);
    if (n !== undefined) return n;
  }
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const n = parseNumberCell(data[i]);
    if (n !== undefined) return n;
  }
  return undefined;
}

function valuesPreview(data: string[]): number[] {
  return data
    .map(parseNumberCell)
    .filter((n): n is number => n !== undefined)
    .slice(0, 8);
}

function tableName(table: RuzTabulka): string {
  return table.nazov?.sk ?? table.nazov?.en ?? "Neznáma tabuľka";
}

function extractRuzNumericRows(
  statement: RuzStatement,
  vykaz: RuzVykaz | undefined,
  year: number,
): FinanceMappingRuzRow[] {
  const rows: FinanceMappingRuzRow[] = [];
  if (!vykaz?.obsah?.tabulky) return rows;
  const statementId = statement.id != null ? String(statement.id) : "—";
  const reportId = vykaz.id != null ? String(vykaz.id) : undefined;

  for (const table of vykaz.obsah.tabulky) {
    const name = tableName(table);
    const data = table.data ?? [];
    const lower = name.toLowerCase();

    const pushRow = (
      rowName: string,
      selectedField: FinanceField,
      selectedValue: number | undefined,
      reason: string,
    ) => {
      rows.push({
        statementId,
        reportId,
        year,
        tableName: name,
        rowName,
        values: valuesPreview(data),
        selectedField: selectedValue !== undefined ? selectedField : undefined,
        selectedValue,
        reason,
      });
    };

    if (lower.includes("aktív") || lower.includes("asset")) {
      pushRow(
        "Aktíva spolu",
        "assets",
        firstNumeric(data),
        "selected first numeric current-period value from assets table",
      );
    }

    if (lower.includes("pasív") || lower.includes("liabil")) {
      pushRow(
        "Pasíva spolu",
        "liabilities",
        firstNumeric(data),
        "selected first numeric current-period value from liabilities table",
      );
    }

    if (lower.includes("zisk") || lower.includes("income")) {
      pushRow(
        "Tržby z predaja tovaru / vlastných výrobkov / služieb",
        "revenue",
        firstNumeric(data),
        "selected first numeric current-period value from income statement as revenue/sales total",
      );
      pushRow(
        "Výsledok hospodárenia za účtovné obdobie",
        "profit",
        lastCurrentPeriodNumeric(data),
        "selected last current-period numeric value from income statement as accounting result",
      );
    }
  }

  return rows;
}

function financialYearFromRows(year: number, rows: FinanceMappingRuzRow[]): FinancialYear | null {
  const pick = (field: FinanceField): number | undefined =>
    rows.find((row) => row.selectedField === field && row.selectedValue !== undefined)?.selectedValue;
  const revenue = pick("revenue");
  const profit = pick("profit");
  const assets = pick("assets");
  const liabilities = pick("liabilities");
  if ([revenue, profit, assets, liabilities].every((v) => v === undefined)) return null;
  return {
    year,
    revenue: revenue ?? 0,
    profit: profit ?? 0,
    ebitda: 0,
    assets: assets ?? 0,
    liabilities: liabilities ?? 0,
    source: "ruz",
    availableFields: ([
      ["revenue", revenue],
      ["profit", profit],
      ["assets", assets],
      ["liabilities", liabilities],
    ] as const)
      .filter(([, value]) => value !== undefined)
      .map(([field]) => field),
  };
}

function pickBestPdf(prilohy: RuzPriloha[] | undefined): RuzPriloha | undefined {
  if (!prilohy) return undefined;
  return prilohy.find(
    (p) => p.mimeType?.toLowerCase().includes("pdf") && p.id != null,
  );
}

function pickBestExcel(prilohy: RuzPriloha[] | undefined): RuzPriloha | undefined {
  if (!prilohy) return undefined;
  return prilohy.find((p) => {
    const mt = p.mimeType?.toLowerCase() ?? "";
    const name = p.meno?.toLowerCase() ?? "";
    return (
      mt.includes("spreadsheet") ||
      mt.includes("excel") ||
      name.endsWith(".xls") ||
      name.endsWith(".xlsx")
    );
  });
}

function normalizeStatement(
  raw: RuzStatement,
  vykaz: RuzVykaz | undefined,
): AccountingStatement | null {
  if (raw.id == null) return null;
  const yearSrc =
    raw.datumZostaveniaK ?? raw.obdobieDo ?? raw.datumZostavenia ?? raw.datumPodania;
  const yearMatch = yearSrc?.match(/^(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();

  const pdfPriloha = pickBestPdf(vykaz?.prilohy);
  const xlsPriloha = pickBestExcel(vykaz?.prilohy);
  const vykazId = vykaz?.id;

  const detailUrl = vykazId != null ? reportDetailUrl(vykazId) : undefined;
  const pdfUrl =
    pdfPriloha?.id != null
      ? attachmentUrl(pdfPriloha.id)
      : vykazId != null
        ? reportPdfUrl(vykazId)
        : undefined;
  const excelUrl = xlsPriloha?.id != null ? attachmentUrl(xlsPriloha.id) : undefined;

  const attachments = (vykaz?.prilohy ?? [])
    .filter((p): p is RuzPriloha & { id: number } => p.id != null)
    .map((p) => ({
      id: String(p.id),
      name: p.meno ?? "prílohy",
      mimeType: p.mimeType ?? "application/octet-stream",
      url: attachmentUrl(p.id),
      sizeBytes: p.velkostPrilohy,
    }));

  return {
    id: String(raw.id),
    statementId: String(raw.id),
    vykazId: vykazId != null ? String(vykazId) : undefined,
    year,
    type: raw.typ?.trim() || "Neznámy typ",
    periodFrom: raw.obdobieOd,
    periodTo: raw.obdobieDo,
    submittedAt: raw.datumPodania,
    submittedDate: raw.datumPodania,
    preparedAt: raw.datumZostavenia,
    approvedAt: raw.datumSchvalenia,
    consolidated: raw.konsolidovana,
    detailUrl,
    pdfUrl,
    excelUrl,
    sourceUrl: detailUrl,
    attachments: attachments.length ? attachments : undefined,
    parsedNumericRowsCount: countNumericCells(vykaz),
    parsedNumericRows: extractRuzNumericRows(raw, vykaz, year),
  };
}

async function fetchStatementRecords(
  ico: string,
  diagnostics?: ProviderDiagnostic[],
): Promise<Array<{ statement: RuzStatement; vykaz?: RuzVykaz }>> {
  const list = await ruzFetch<RuzUnitList>(
    `/uctovne-jednotky?zmenene-od=1900-01-01&ico=${encodeURIComponent(ico)}`,
  );
  const unitId = list.id?.[0];
  if (unitId == null) return [];

  const unit = await ruzFetch<RuzUnit>(`/uctovna-jednotka?id=${unitId}`);
  const ids = (unit.idUctovnychZavierok ?? []).slice(0, MAX_STATEMENTS);
  if (ids.length === 0) return [];

  const settled = await Promise.allSettled(
    ids.map((id) => ruzFetch<RuzStatement>(`/uctovna-zavierka?id=${id}`)),
  );

  const statementRecords: Array<{ statement: RuzStatement; vykaz?: RuzVykaz }> = [];
  const vykazFetches: Promise<void>[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    const record: { statement: RuzStatement; vykaz?: RuzVykaz } = { statement: s.value };
    statementRecords.push(record);
    const vykazId = s.value.idUctovnychVykazov?.[0];
    if (vykazId != null) {
      vykazFetches.push(
        ruzFetch<RuzVykaz>(`/uctovny-vykaz?id=${vykazId}`)
          .then((v) => {
            record.vykaz = v;
          })
          .catch((err: unknown) => {
            const e = err as RuzError;
            diagnostics?.push({
              source: "ruz",
              capability: "statements",
              endpoint: e.endpoint,
              httpStatus: e.status,
              errorCode: e.code ?? "unknown",
              rawError: e.rawResponse,
              normalizedError: `Chyba pri načítaní výkazu ${vykazId}: ${e.message}`,
            });
          }),
      );
    }
  }
  await Promise.all(vykazFetches);
  return statementRecords;
}

export async function ruzStatements(
  ico: string,
  diagnostics?: ProviderDiagnostic[],
): Promise<ProviderResult<AccountingStatement[]>> {
  try {
    const statementRecords = await fetchStatementRecords(ico, diagnostics);
    if (statementRecords.length === 0) {
      return empty("ruz", "statements", [], "V RÚZ neexistuje žiadna účtovná jednotka.");
    }

    const statements: AccountingStatement[] = [];
    for (const r of statementRecords) {
      const norm = normalizeStatement(r.statement, r.vykaz);
      if (norm) statements.push(norm);
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
    return unavailable(
      "ruz",
      "statements",
      [],
      "unavailable",
      e.message ?? "Chyba pri komunikácii s RÚZ.",
    );
  }
}

export async function ruzFinancials(
  ico: string,
  diagnostics?: ProviderDiagnostic[],
): Promise<ProviderResult<FinancialYear[]>> {
  try {
    const statementRecords = await fetchStatementRecords(ico, diagnostics);
    if (statementRecords.length === 0) {
      return empty("ruz", "financials", [], "V RÚZ neexistuje žiadna účtovná jednotka.");
    }

    const byYear = new Map<number, FinancialYear>();
    for (const r of statementRecords) {
      const yearSrc =
        r.statement.datumZostaveniaK ?? r.statement.obdobieDo ?? r.statement.datumZostavenia ?? r.statement.datumPodania;
      const yearMatch = yearSrc?.match(/^(\d{4})/);
      if (!yearMatch) continue;
      const year = Number(yearMatch[1]);
      const rows = extractRuzNumericRows(r.statement, r.vykaz, year);
      const fin = financialYearFromRows(year, rows);
      if (fin) byYear.set(year, fin);
    }

    const data = [...byYear.values()].sort((a, b) => a.year - b.year);
    if (data.length === 0) {
      return empty("ruz", "financials", [], "RÚZ nevrátil strojovo čitateľné finančné hodnoty.");
    }
    return ok("ruz", "financials", data);
  } catch (err) {
    const e = err as RuzError;
    diagnostics?.push({
      source: "ruz",
      capability: "financials",
      endpoint: e.endpoint,
      httpStatus: e.status,
      errorCode: e.code ?? "unknown",
      rawError: e.rawResponse,
      normalizedError: e.message,
    });
    return unavailable(
      "ruz",
      "financials",
      [],
      "unavailable",
      e.message ?? "Chyba pri komunikácii s RÚZ.",
    );
  }
}
