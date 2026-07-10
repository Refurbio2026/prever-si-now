// Finančná správa SR — Register platiteľov DPH.
// Official machine-readable distribution (confirmed 2026-07):
//   https://report.financnasprava.sk/ds_dphs.zip  (XML: ds_dphs.xml + XSD)
// Landing page:
//   https://opendata.financnasprava.sk/mi/opendata/show/zoznam-danovych-subjektov-registrovanych-pre-dph1
//
// The uncompressed XML is ~125 MB, so we NEVER buffer it. Streaming path:
//   fetch → hash bytes → fflate Unzip → XML chunk state machine → onItem.
// The regular importVatRegister() aggregates a small in-memory sample for the
// existing pipeline; importVatRegisterStreamed() is used by the orchestrator
// to stage records incrementally.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type JsonValue,
  type TaxImporterOutcome,
  type TaxStatusRecord,
  normalizeIco,
} from "@/lib/tax-status.types";
import { streamFsXml, toIsoDate } from "@/lib/providers/fs-xml-stream.server";
import { taxRecordHash } from "@/lib/reconcile.server";

const LANDING_URL =
  "https://opendata.financnasprava.sk/mi/opendata/show/zoznam-danovych-subjektov-registrovanych-pre-dph1";

function logVat(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[datahub] VAT ${message}`);
}

function logVatError(message: string, err?: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    `[datahub] VAT ${message}`,
    err instanceof Error ? (err.stack ?? err.message) : (err ?? ""),
  );
}

function mapItem(fields: Record<string, string>, sourceUrl: string): TaxStatusRecord | null {
  const ico = normalizeIco(fields.ICO ?? "");
  if (!ico) return null;
  const regDate = toIsoDate(fields.DATUM_REG ?? fields.PLAT_DPH_OD ?? "");
  const cancelDate = toIsoDate(fields.DATUM_ZRUS ?? fields.PLAT_DPH_DO ?? "");
  const raw: JsonValue = fields as unknown as JsonValue;
  return {
    ico,
    dataset: "vat_registered",
    taxDebtorFound: null,
    taxDebtAmount: null,
    // Presence in the register = registered. Explicit cancellation date flips to false.
    vatRegistered: cancelDate ? false : true,
    icDph: (fields.IC_DPH ?? "").trim() || null,
    vatRegistrationDate: regDate,
    taxReliabilityIndex: null,
    sourceRecordDate: cancelDate ?? regDate,
    sourceUrl,
    rawData: raw,
  };
}

/** Non-streaming variant kept only for tests / diagnostics. Caps at 2 000
 *  records so it can never allocate more than a few MB. Not used in prod. */
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
        "Zdrojová URL FS pre register DPH nie je nakonfigurovaná (FS_VAT_REGISTER_URL).",
      records: [],
      sourceRecordDate: null,
    };
  }

  const records: TaxStatusRecord[] = [];
  let downloaded = 0;
  let withValidIco = 0;
  const meta = await streamFsXml({
    url: configuredUrl,
    xmlSuffix: "ds_dphs.xml",
    rootDateTag: "DatumAktualizacieZoznamu",
    maxItems: 2_000,
    onItem: (fields) => {
      downloaded++;
      const rec = mapItem(fields, configuredUrl);
      if (rec) {
        withValidIco++;
        records.push(rec);
      }
    },
  });

  return {
    dataset: "vat_registered",
    status: meta.status === 200 ? "success" : "failed",
    sourceUrl: configuredUrl,
    recordsDownloaded: downloaded,
    recordsNormalized: records.length,
    recordsWithValidIco: withValidIco,
    contentHash: meta.contentHash || null,
    errorMessage:
      meta.status === 200
        ? null
        : `HTTP ${meta.status} pri sťahovaní registra DPH.`,
    records,
    sourceRecordDate: toIsoDate(meta.rootDate),
  };
}

// ---------- streaming path for production ----------

export interface StreamedVatSummary {
  sourceUrl: string;
  contentHash: string;
  sourceRecordDate: string | null;
  recordsDownloaded: number;
  recordsNormalized: number;
  recordsWithValidIco: number;
  recordsStaged: number;
  duplicateRatio: number;
  sampleColumnNames: string[];
  httpStatus: number;
  lastModified: string | null;
  etag: string | null;
  contentType: string;
  bytesRead: number;
  errorMessage: string | null;
}

/** Stream FS VAT register into the given staging table in batches. Records
 *  are written incrementally, so peak memory stays bounded regardless of the
 *  dataset size. Returns aggregate stats the orchestrator uses for validation
 *  and run-log fields. */
export async function importVatRegisterStreamed(
  admin: SupabaseClient,
  runId: string,
  batchSize = 1000,
  progress?: import("@/lib/import-progress.server").ProgressCtx | null,
): Promise<StreamedVatSummary> {
  const configuredUrl = process.env.FS_VAT_REGISTER_URL ?? "";
  if (!configuredUrl) {
    return {
      sourceUrl: LANDING_URL,
      contentHash: "",
      sourceRecordDate: null,
      recordsDownloaded: 0,
      recordsNormalized: 0,
      recordsWithValidIco: 0,
      recordsStaged: 0,
      duplicateRatio: 0,
      sampleColumnNames: [],
      httpStatus: 0,
      lastModified: null,
      etag: null,
      contentType: "",
      bytesRead: 0,
      errorMessage:
        "Zdrojová URL FS pre register DPH nie je nakonfigurovaná (FS_VAT_REGISTER_URL).",
    };
  }

  let downloaded = 0;
  let normalized = 0;
  let withValidIco = 0;
  let staged = 0;
  const seen = new Set<string>();
  let duplicates = 0;
  let stagingError: string | null = null;
  let batchNo = 0;
  let batch: Array<{
    ico: string;
    dataset: "vat_registered";
    tax_debtor_found: boolean | null;
    tax_debt_amount: number | null;
    vat_registered: boolean | null;
    ic_dph: string | null;
    vat_registration_date: string | null;
    tax_reliability_index: string | null;
    source_url: string;
    raw_data: JsonValue;
    source_record_hash: string;
    run_id: string;
  }> = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0 || stagingError) return;
    batchNo++;
    const rows = batch.length;
    const { error } = await admin.from("staging_tax_records").insert(batch);
    if (error) {
      stagingError = error.message;
      logVatError(`staging batch ${batchNo} failed: ${error.message}`);
      return;
    }
    staged += batch.length;
    logVat(`staging batch ${batchNo} rows=${rows} staged=${staged}`);
    batch = [];
  };

  let meta;
  try {
    logVat(`download start url=${configuredUrl}`);
    meta = await streamFsXml({
      url: configuredUrl,
      xmlSuffix: "ds_dphs.xml",
      rootDateTag: "DatumAktualizacieZoznamu",
      onItem: async (fields) => {
        if (stagingError) return;
        downloaded++;
        const rec = mapItem(fields, configuredUrl);
        if (!rec || !rec.ico) return;
        normalized++;
        withValidIco++;
        const key = `vat_registered|${rec.ico}`;
        if (seen.has(key)) {
          duplicates++;
          return;
        }
        seen.add(key);
        batch.push({
          ico: rec.ico,
          dataset: "vat_registered",
          tax_debtor_found: rec.taxDebtorFound,
          tax_debt_amount: rec.taxDebtAmount,
          vat_registered: rec.vatRegistered,
          ic_dph: rec.icDph,
          vat_registration_date: rec.vatRegistrationDate,
          tax_reliability_index: rec.taxReliabilityIndex,
          source_url: rec.sourceUrl,
          raw_data: rec.rawData,
          source_record_hash: taxRecordHash(rec),
          run_id: runId,
        });
        if (batch.length >= batchSize) await flush();
      },
    });
    await flush();
    logVat(`downloaded bytes=${meta.bytesRead} hash=${meta.contentHash.slice(0, 12)} items=${meta.itemCount}`);
  } catch (err) {
    logVatError("streaming error", err);
    return {
      sourceUrl: configuredUrl,
      contentHash: "",
      sourceRecordDate: null,
      recordsDownloaded: downloaded,
      recordsNormalized: normalized,
      recordsWithValidIco: withValidIco,
      recordsStaged: staged,
      duplicateRatio: normalized > 0 ? duplicates / normalized : 0,
      sampleColumnNames: [],
      httpStatus: 0,
      lastModified: null,
      etag: null,
      contentType: "",
      bytesRead: 0,
      errorMessage: `Streaming zlyhal: ${err instanceof Error ? err.message : "neznáma chyba"}`,
    };
  }

  return {
    sourceUrl: configuredUrl,
    contentHash: meta.contentHash,
    sourceRecordDate: toIsoDate(meta.rootDate),
    recordsDownloaded: downloaded,
    recordsNormalized: normalized,
    recordsWithValidIco: withValidIco,
    recordsStaged: staged,
    duplicateRatio: normalized > 0 ? duplicates / normalized : 0,
    sampleColumnNames: meta.sampleColumnNames,
    httpStatus: meta.status,
    lastModified: meta.lastModified,
    etag: meta.etag,
    contentType: meta.contentType,
    bytesRead: meta.bytesRead,
    errorMessage: stagingError,
  };
}
