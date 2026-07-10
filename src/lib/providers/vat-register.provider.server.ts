// Finančná správa SR — Register platiteľov DPH (VAT register).
// Landing: https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy
// Open data portal: https://opendata.financnasprava.sk/
//
// We do NOT guess the download URL. Set `FS_VAT_REGISTER_URL` server-only
// env var to the official CSV/ZIP endpoint published on opendata.
// Without it we return `not_implemented`.

import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import {
  type JsonValue,
  type TaxImporterOutcome,
  type TaxStatusRecord,
  normalizeIco,
} from "@/lib/tax-status.types";

const LANDING_URL =
  "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy";
const FETCH_TIMEOUT_MS = 20_000;

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
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function detectSeparator(header: string): string {
  const cands = [";", ",", "\t", "|"];
  let best = ",";
  let n = -1;
  for (const c of cands) {
    const k = header.split(c).length;
    if (k > n) {
      best = c;
      n = k;
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
  const norm = header.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ""));
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

function normalizeDate(input: string | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  // ISO already?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // dd.mm.yyyy
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    return `${m[3]}-${mo}-${d}`;
  }
  return null;
}

export async function importVatRegister(): Promise<TaxImporterOutcome> {
  const configuredUrl = process.env.FS_VAT_REGISTER_URL ?? "";
  if (!configuredUrl) {
    return {
      dataset: "vat_registered",
      status: "not_implemented",
      sourceUrl: LANDING_URL,
      recordsDownloaded: 0,
      recordsNormalized: 0,
      recordsWithValidIco: 0,
      contentHash: null,
      errorMessage:
        "Zdrojová URL registra platiteľov DPH nie je nakonfigurovaná (FS_VAT_REGISTER_URL).",
      records: [],
      sourceRecordDate: null,
    };
  }

  const res = await fetchWithTimeout(configuredUrl);
  if (!res.ok) {
    return {
      dataset: "vat_registered",
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
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  let csv: string | null = null;
  if (ct.includes("zip") || configuredUrl.toLowerCase().endsWith(".zip")) {
    csv = extractCsvFromZip(buf);
  } else {
    csv = new TextDecoder("utf-8").decode(buf);
  }
  if (!csv) {
    return {
      dataset: "vat_registered",
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
      dataset: "vat_registered",
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
  const icDphIdx = findColumn(header, ["icdph", "ic_dph", "vatid"]);
  const regDateIdx = findColumn(header, [
    "datumRegistracie",
    "datum_registracie",
    "regDatum",
    "platnostOd",
  ]);
  const cancelDateIdx = findColumn(header, [
    "datumZrusenia",
    "datum_zrusenia",
    "platnostDo",
  ]);
  const statusIdx = findColumn(header, ["status", "stav"]);

  const today = new Date().toISOString().slice(0, 10);
  const records: TaxStatusRecord[] = [];
  let downloaded = 0;
  let withValidIco = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    downloaded++;
    const ico = normalizeIco(icoIdx >= 0 ? row[icoIdx] : "");
    if (!ico) continue;
    withValidIco++;

    const icDph = icDphIdx >= 0 ? (row[icDphIdx] ?? "").trim() || null : null;
    const regDate = normalizeDate(regDateIdx >= 0 ? row[regDateIdx] : "");
    const cancelDate = normalizeDate(
      cancelDateIdx >= 0 ? row[cancelDateIdx] : "",
    );
    const statusText =
      statusIdx >= 0 ? (row[statusIdx] ?? "").toLowerCase() : "";

    // "vatRegistered = false" ONLY when the source explicitly confirms
    // cancellation. Otherwise leave it at true (record present) or null.
    let vatRegistered: boolean | null = true;
    if (
      cancelDate ||
      statusText.includes("zrušený") ||
      statusText.includes("zruseny") ||
      statusText.includes("zrušené") ||
      statusText.includes("vymazan")
    ) {
      vatRegistered = false;
    }

    const rawObj: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) rawObj[header[i]] = row[i] ?? "";

    records.push({
      ico,
      dataset: "vat_registered",
      taxDebtorFound: null,
      taxDebtAmount: null,
      vatRegistered,
      icDph,
      vatRegistrationDate: regDate,
      taxReliabilityIndex: null,
      sourceRecordDate: cancelDate ?? regDate ?? today,
      sourceUrl: LANDING_URL,
      rawData: rawObj as JsonValue,
    });
  }

  return {
    dataset: "vat_registered",
    status: records.length > 0 ? "success" : "empty",
    sourceUrl: configuredUrl,
    recordsDownloaded: downloaded,
    recordsNormalized: records.length,
    recordsWithValidIco: withValidIco,
    contentHash,
    errorMessage: null,
    records,
    sourceRecordDate: today,
  };
}
