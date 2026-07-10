// Sociálna poisťovňa (SP) — public debtor list importer.
// Source: https://www.socpoist.sk/zoznam-dlznikov exposes an internal
// download endpoint that serves the current national debtor dataset as a
// ZIP containing CSV + fixed-width TXT files. This file only downloads
// the ZIP, extracts the CSV, and normalizes rows.

import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import {
  type ImporterOutcome,
  type InsuranceDebtRecord,
  type JsonValue,
  normalizeIco,
  parseSkAmount,
} from "@/lib/insurance-debt.types";

const LANDING_URL = "https://www.socpoist.sk/zoznam-dlznikov";
const DEFAULT_DOWNLOAD_URL =
  "https://www.socpoist.sk/api/idsp/download/302e4a86-4333-4d75-b441-d191d6aff6c4";
const FETCH_TIMEOUT_MS = 8_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "User-Agent": "PreverSi DataHub (+https://preversi.sk)",
        Accept: "*/*",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Split a CSV line respecting simple `"quoted, values"` quoting. The SP CSV
 * uses `,` as the separator with UTF-8 BOM.
 */
function splitCsvLine(line: string): string[] {
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
        } else {
          inQuotes = false;
        }
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  const lines = clean.split(/\r?\n/);
  let buf = "";
  let quoteCount = 0;
  for (const line of lines) {
    buf = buf ? buf + "\n" + line : line;
    for (const ch of line) if (ch === '"') quoteCount++;
    if (quoteCount % 2 === 0) {
      if (buf.trim().length > 0) rows.push(splitCsvLine(buf));
      buf = "";
      quoteCount = 0;
    }
  }
  if (buf.trim().length > 0) rows.push(splitCsvLine(buf));
  return rows;
}

/** Derive an ISO date from the CSV filename `dlznici_<week>_<year>.csv`. */
function deriveDatasetDate(filename: string): string | null {
  const m = /dlznici_(\d{1,2})_(\d{4})/i.exec(filename);
  if (!m) return null;
  const week = Number(m[1]);
  const year = Number(m[2]);
  if (!Number.isFinite(week) || !Number.isFinite(year)) return null;
  // ISO week → Thursday of that week (approx). Good enough for a snapshot date.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const weekStart = new Date(jan4);
  weekStart.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  return weekStart.toISOString().slice(0, 10);
}

export async function importSocialInsuranceDebtors(): Promise<ImporterOutcome> {
  const base: ImporterOutcome = {
    provider: "social_insurance",
    status: "failed",
    sourceUrl: LANDING_URL,
    recordsDownloaded: 0,
    recordsNormalized: 0,
    recordsWithIco: 0,
    contentHash: null,
    errorMessage: null,
    records: [],
    sourceRecordDate: null,
  };

  try {
    const res = await fetchWithTimeout(DEFAULT_DOWNLOAD_URL);
    if (!res.ok) {
      return {
        ...base,
        errorMessage: `HTTP ${res.status} pri sťahovaní SP datasetu.`,
      };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const contentHash = createHash("sha256").update(buf).digest("hex");
    const entries = unzipSync(buf);
    const csvName = Object.keys(entries).find((n) => n.toLowerCase().endsWith(".csv"));
    if (!csvName) {
      return { ...base, errorMessage: "V ZIP archíve chýba CSV súbor." };
    }
    const csvText = strFromU8(entries[csvName]);
    const rows = parseCsv(csvText);
    if (rows.length < 2) {
      return {
        ...base,
        status: "empty",
        contentHash,
        errorMessage: "Prázdny CSV zoznam.",
      };
    }
    const header = rows[0].map((h) => h.trim().toUpperCase());
    const idxName = header.findIndex((h) => h.includes("MENO") || h.includes("NÁZOV"));
    const idxIco = header.findIndex((h) => h.includes("IČO") || h.includes("ICO"));
    const idxAddr = header.findIndex((h) => h.includes("ADRESA"));
    const idxCity = header.findIndex((h) => h.includes("MESTO"));
    const idxAmount = header.findIndex((h) => h.includes("SUMA"));
    const sourceRecordDate = deriveDatasetDate(csvName);

    const records: InsuranceDebtRecord[] = [];
    let withIco = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const ico = normalizeIco(idxIco >= 0 ? row[idxIco] : null);
      const name = (idxName >= 0 ? row[idxName] : "")?.trim() || null;
      const addressParts = [
        idxAddr >= 0 ? row[idxAddr]?.trim() : "",
        idxCity >= 0 ? row[idxCity]?.trim() : "",
      ].filter((v): v is string => !!v && v.length > 0);
      const amount = parseSkAmount(idxAmount >= 0 ? row[idxAmount] : null);
      if (ico) withIco++;
      // Only persist rows with a matchable IČO; the rest cannot be attached
      // to a company profile per spec (never match by name).
      if (!ico) continue;
      const raw: JsonValue = row.reduce<Record<string, JsonValue>>(
        (acc, val, idx) => {
          acc[header[idx] ?? `col_${idx}`] = val ?? null;
          return acc;
        },
        {},
      );
      records.push({
        ico,
        provider: "social_insurance",
        debtorFound: true,
        debtAmount: amount,
        currency: "EUR",
        debtorName: name,
        address: addressParts.join(", ") || null,
        sourceRecordDate,
        sourceUrl: LANDING_URL,
        rawData: raw,
      });
    }

    return {
      provider: "social_insurance",
      status: records.length === 0 ? "empty" : "success",
      sourceUrl: LANDING_URL,
      recordsDownloaded: rows.length - 1,
      recordsNormalized: records.length,
      recordsWithIco: withIco,
      contentHash,
      errorMessage: null,
      records,
      sourceRecordDate,
    };
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timeout ${FETCH_TIMEOUT_MS} ms pri sťahovaní SP datasetu.`
          : err.message
        : "Neznáma chyba pri sťahovaní SP datasetu.";
    return { ...base, errorMessage: msg };
  }
}
