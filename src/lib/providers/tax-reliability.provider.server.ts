// Finančná správa SR — Index daňovej spoľahlivosti (Tax Reliability Index).
// Landing: https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy
//
// FS SR publishes a searchable list per DIČ with the classification value
// (e.g. "vysoko spoľahlivý", "spoľahlivý", "nespoľahlivý"). At the time of
// writing there is no confirmed bulk machine-readable download URL that
// we can hardcode without guessing. This importer therefore returns
// `not_implemented` unless `FS_TAX_RELIABILITY_URL` is explicitly set to a
// CSV/JSON export produced by the official portal.

import { createHash } from "node:crypto";
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

interface JsonRow {
  ico?: string | number;
  ICO?: string | number;
  index?: string;
  indexSpolahlivosti?: string;
  hodnota?: string;
  datum?: string;
  datumZverejnenia?: string;
}

function normalizeDate(input: string | undefined): string | null {
  if (!input) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) return input.slice(0, 10);
  const m = input.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

export async function importTaxReliability(): Promise<TaxImporterOutcome> {
  const configuredUrl = process.env.FS_TAX_RELIABILITY_URL ?? "";
  if (!configuredUrl) {
    return {
      dataset: "tax_reliability",
      status: "not_implemented",
      sourceUrl: LANDING_URL,
      recordsDownloaded: 0,
      recordsNormalized: 0,
      recordsWithValidIco: 0,
      contentHash: null,
      errorMessage:
        "Oficiálny individuálny dataset podľa IČO nebol potvrdený. Známe FS OpenData zdroje obsahujú len agregovanú štatistiku indexu spoľahlivosti — jednotlivé firmy zatiaľ neimportujeme.",
      records: [],
      sourceRecordDate: null,
    };
  }

  const res = await fetchWithTimeout(configuredUrl);
  if (!res.ok) {
    return {
      dataset: "tax_reliability",
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
  const text = new TextDecoder("utf-8").decode(buf);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      dataset: "tax_reliability",
      status: "failed",
      sourceUrl: configuredUrl,
      recordsDownloaded: 0,
      recordsNormalized: 0,
      recordsWithValidIco: 0,
      contentHash,
      errorMessage:
        "Očakávaný JSON dataset — parsovanie zlyhalo. Ak zdroj používa iný formát, doplňte parser.",
      records: [],
      sourceRecordDate: null,
    };
  }

  const list: JsonRow[] = Array.isArray(parsed)
    ? (parsed as JsonRow[])
    : Array.isArray((parsed as { data?: unknown }).data)
      ? ((parsed as { data: JsonRow[] }).data)
      : [];

  const today = new Date().toISOString().slice(0, 10);
  const records: TaxStatusRecord[] = [];
  let downloaded = 0;
  let withValidIco = 0;

  for (const row of list) {
    downloaded++;
    const ico = normalizeIco(String(row.ico ?? row.ICO ?? ""));
    if (!ico) continue;
    withValidIco++;
    const value = (
      row.indexSpolahlivosti ??
      row.index ??
      row.hodnota ??
      ""
    ).toString().trim();
    if (!value) continue;
    const recordDate =
      normalizeDate(row.datumZverejnenia) ?? normalizeDate(row.datum) ?? today;
    records.push({
      ico,
      dataset: "tax_reliability",
      taxDebtorFound: null,
      taxDebtAmount: null,
      vatRegistered: null,
      icDph: null,
      vatRegistrationDate: null,
      taxReliabilityIndex: value,
      sourceRecordDate: recordDate,
      sourceUrl: LANDING_URL,
      rawData: row as unknown as JsonValue,
    });
  }

  return {
    dataset: "tax_reliability",
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
