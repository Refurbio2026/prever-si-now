// Finančná správa SR — Zoznam daňových dlžníkov.
// Official machine-readable distribution (confirmed 2026-07):
//   https://report.financnasprava.sk/ds_dsdd.zip  (XML: ds_dsdd.xml + XSD)
// Landing page (dataset metadata):
//   https://opendata.financnasprava.sk/mi/opendata/show/zoznam-danovych-dlznikov
//
// IMPORTANT: The official dataset publishes only NAZOV_SUBJEKTU, CIASTKA,
// ULICA_CISLO, PSC, OBEC. It does NOT include IČO. Our reconciliation is
// keyed on IČO, so we return status="failed" with a clear validation message
// so nothing is written to production and current records are preserved.

import {
  type TaxImporterOutcome,
  type TaxStatusRecord,
  parseSkAmount,
} from "@/lib/tax-status.types";
import { streamFsXml, toIsoDate } from "@/lib/providers/fs-xml-stream.server";

const LANDING_URL =
  "https://opendata.financnasprava.sk/mi/opendata/show/zoznam-danovych-dlznikov";

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
        "Zdrojová URL FS pre zoznam daňových dlžníkov nie je nakonfigurovaná (FS_TAX_DEBTORS_URL).",
      records: [],
      sourceRecordDate: null,
    };
  }

  // Stream full file (only ~20 MB uncompressed) and collect records without IČO
  // just for diagnostic counting. We keep raw fields but do NOT populate `ico`.
  const collected: TaxStatusRecord[] = [];
  let downloaded = 0;
  let meta;
  try {
    // eslint-disable-next-line no-console
    console.log(`[datahub] tax_debtors download start url=${configuredUrl}`);
    meta = await streamFsXml({
      url: configuredUrl,
      xmlSuffix: "ds_dsdd.xml",
      rootDateTag: "DatumAktualizacieZoznamu",
      logLabel: "tax_debtors",
      tempFilename: "preversi-tax-debtors.zip",
      onItem: (fields) => {
        downloaded++;
        // Deliberately not setting ico — dataset has no IČO field.
        collected.push({
          ico: null,
          dataset: "tax_debtors",
          taxDebtorFound: true,
          taxDebtAmount: parseSkAmount(fields.CIASTKA ?? ""),
          vatRegistered: null,
          icDph: null,
          vatRegistrationDate: null,
          taxReliabilityIndex: null,
          sourceRecordDate: null,
          sourceUrl: configuredUrl,
          rawData: fields,
        });
      },
    });
    // eslint-disable-next-line no-console
    console.log(
      `[datahub] tax_debtors downloaded bytes=${meta.bytesRead} hash=${meta.contentHash.slice(0, 12)} items=${meta.itemCount}`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[datahub] tax_debtors importer error",
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
    return {
      dataset: "tax_debtors",
      status: "failed",
      sourceUrl: configuredUrl,
      recordsDownloaded: 0,
      recordsNormalized: 0,
      recordsWithValidIco: 0,
      contentHash: null,
      errorMessage: `Sťahovanie/parsovanie zlyhalo: ${err instanceof Error ? err.message : "neznáma chyba"}`,
      records: [],
      sourceRecordDate: null,
    };
  }

  if (meta.status !== 200) {
    return {
      dataset: "tax_debtors",
      status: "failed",
      sourceUrl: configuredUrl,
      recordsDownloaded: 0,
      recordsNormalized: 0,
      recordsWithValidIco: 0,
      contentHash: meta.contentHash || null,
      errorMessage: `HTTP ${meta.status} pri sťahovaní datasetu.`,
      records: [],
      sourceRecordDate: null,
    };
  }

  const sourceDate = toIsoDate(meta.rootDate);

  // Required-column check: dataset must include an IČO-equivalent field usable
  // by our reconciliation. It does not — fail cleanly, preserve current data.
  return {
    dataset: "tax_debtors",
    status: "failed",
    sourceUrl: configuredUrl,
    recordsDownloaded: downloaded,
    recordsNormalized: collected.length,
    recordsWithValidIco: 0,
    contentHash: meta.contentHash,
    errorMessage:
      `Oficiálny dataset FS „Zoznam daňových dlžníkov" neobsahuje IČO ` +
      `(polia: ${meta.sampleColumnNames.join(", ")}). ` +
      `Reconciliation vyžaduje IČO — aktivácia zablokovaná, aktuálne záznamy sú zachované.`,
    records: [],
    sourceRecordDate: sourceDate,
  };
}
