// Finančná správa SR — public list of tax debtors (Zoznam daňových dlžníkov).
// Source landing page: https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy
// Open data portal: https://opendata.financnasprava.sk/
//
// Per project policy we do not guess the download URL. When the dataset
// download URL is not explicitly configured via `FS_TAX_DEBTORS_URL`
// (server-only env var), this importer returns `not_implemented` with a
// clear diagnostic. When configured, it downloads and parses ZIP/CSV/XML.

import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import {
  type JsonValue,
  type TaxImporterOutcome,
  type TaxStatusRecord,
  normalizeIco,
  parseSkAmount,
} from "@/lib/tax-status.types";

const LANDING_URL =
  "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy/detail/_9c3b4de6-f8f4-4d1e-8ecd-6f9e9c8c1234";
const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "PreverSi DataHub (+https://preversi.sk)",
        Accept: "*/*",
      },
    });
  } finally {
    clearTimeout(t);
  }
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function detectSeparator(headerLine: string): string {
  const cands = [";", ",", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const c of cands) {
    const n = headerLine.split(c).length;
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const sep = detectSeparator(lines[0]);
  return lines.map((l) => splitCsvLine(l, sep));
}

function findColumn(header: string[], candidates: string[]): number {
  const norm = header.map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]+/g, ""),
  );
  for (const c of candidates) {
    const target = c.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const idx = norm.indexOf(target);
    if (idx >= 0) return idx;
  }
  return -1;
}

function extractCsvFromZip(bytes: Uint8Array): string | null {
  const files = unzipSync(bytes);
  for (const name of Object.keys(files)) {
    if (/\.csv$/i.test(name)) return strFromU8(files[name]);
  }
  return null;
}

export async function importTaxDebtors(): Promise<TaxImporterOutcome> {
  const configuredUrl = process.env.FS_TAX_DEBTORS_URL ?? "";
  if (!configuredUrl) {
    return {
      dataset: "tax_debtors",
      status: "not_implemented",
      sourceUrl: LANDING_URL,
      recordsDownloaded: 0,
      recordsNormalized: 0,
      recordsWithValidIco: 0,
      contentHash: null,
      errorMessage:
        "Zdrojová URL Finančnej správy pre zoznam daňových dlžníkov nie je nakonfigurovaná (FS_TAX_DEBTORS_URL). Bez oficiálneho odkazu neimportujeme nič.",
      records: [],
      sourceRecordDate: null,
    };
  }

  const res = await fetchWithTimeout(configuredUrl);
  if (!res.ok) {
    return {
      dataset: "tax_debtors",
      status: "failed",
      sourceUrl: configuredUrl,
      recordsDownloaded: 0,
      recordsNormalized: 0,
      recordsWithValidIco: 0,
      contentHash: null,
      errorMessage: `HTTP ${res.status} pri sťahovaní datasetu.`,
      records: [],
      sourceRecordDate: null,
    };
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  const contentHash = createHash("sha256").update(buf).digest("hex");

  let csv: string | null = null;
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("zip") || configuredUrl.toLowerCase().endsWith(".zip")) {
    csv = extractCsvFromZip(buf);
  } else {
    csv = new TextDecoder("utf-8").decode(buf);
  }

  if (!csv) {
    return {
      dataset: "tax_debtors",
      status: "failed",
      sourceUrl: configuredUrl,
      recordsDownloaded: 0,
      recordsNormalized: 0,
      recordsWithValidIco: 0,
      contentHash,
      errorMessage: "V ZIP archíve sa nenašiel CSV súbor.",
      records: [],
      sourceRecordDate: null,
    };
  }

  const rows = parseCsv(csv);
  if (rows.length < 2) {
    return {
      dataset: "tax_debtors",
      status: "empty",
      sourceUrl: configuredUrl,
      recordsDownloaded: 0,
      recordsNormalized: 0,
      recordsWithValidIco: 0,
      contentHash,
      errorMessage: null,
      records: [],
      sourceRecordDate: null,
    };
  }

  const header = rows[0];
  const icoIdx = findColumn(header, ["ico", "ičo"]);
  const amountIdx = findColumn(header, [
    "suma",
    "sumaNedoplatku",
    "nedoplatok",
    "dlh",
  ]);
  const dateIdx = findColumn(header, [
    "datumZverejnenia",
    "datum",
    "stavKu",
    "kDatumu",
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const records: TaxStatusRecord[] = [];
  let downloaded = 0;
  let withValidIco = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    downloaded++;
    const rawIco = icoIdx >= 0 ? row[icoIdx] : "";
    const ico = normalizeIco(rawIco ?? "");
    if (!ico) continue;
    withValidIco++;
    const amount = amountIdx >= 0 ? parseSkAmount(row[amountIdx] ?? "") : null;
    const recordDate =
      dateIdx >= 0 && row[dateIdx] ? row[dateIdx].slice(0, 10) : today;
    const rawObj: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) rawObj[header[i]] = row[i] ?? "";
    records.push({
      ico,
      dataset: "tax_debtors",
      taxDebtorFound: true,
      taxDebtAmount: amount,
      vatRegistered: null,
      icDph: null,
      vatRegistrationDate: null,
      taxReliabilityIndex: null,
      sourceRecordDate: recordDate,
      sourceUrl: LANDING_URL,
      rawData: rawObj as JsonValue,
    });
  }

  return {
    dataset: "tax_debtors",
    status: records.length > 0 ? "success" : "empty",
    sourceUrl: configuredUrl,
    recordsDownloaded: downloaded,
    recordsNormalized: records.length,
    recordsWithValidIco: withValidIco,
    contentHash,
    errorMessage: null,
    records,
    sourceRecordDate: records[0]?.sourceRecordDate ?? today,
  };
}
