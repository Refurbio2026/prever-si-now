// Finančná správa SR — Zoznam daňových dlžníkov.
// Official ZIP+XML at report.financnasprava.sk/ds_dsdd.zip.
// The dataset has NO IČO field — we now run entity-matching in the app
// (see src/lib/tax-debt-match.server.ts) using name + address + PSČ.
//
// This importer downloads and parses the XML into a lightweight record
// shape carrying the raw fields required for matching.

import { streamFsXml, toIsoDate } from "@/lib/providers/fs-xml-stream.server";
import { parseSkAmount } from "@/lib/tax-status.types";

const LANDING_URL = "https://opendata.financnasprava.sk/mi/opendata/show/zoznam-danovych-dlznikov";

export interface RawTaxDebtorRecord {
  nameRaw: string;
  addressRaw: string;
  psc: string | null;
  obec: string | null;
  amount: number | null;
}

export interface TaxDebtorsDownloadOutcome {
  status: "success" | "failed" | "not_configured";
  sourceUrl: string;
  contentHash: string | null;
  sourceRecordDate: string | null;
  recordsDownloaded: number;
  records: RawTaxDebtorRecord[];
  errorMessage: string | null;
}

export async function downloadTaxDebtors(): Promise<TaxDebtorsDownloadOutcome> {
  const configuredUrl = process.env.FS_TAX_DEBTORS_URL ?? "";
  if (!configuredUrl) {
    return {
      status: "not_configured",
      sourceUrl: LANDING_URL,
      contentHash: null,
      sourceRecordDate: null,
      recordsDownloaded: 0,
      records: [],
      errorMessage:
        "Zdrojová URL FS pre zoznam daňových dlžníkov nie je nakonfigurovaná (FS_TAX_DEBTORS_URL).",
    };
  }

  const records: RawTaxDebtorRecord[] = [];
  try {
    // eslint-disable-next-line no-console
    console.log(`[datahub] tax_debtors download start url=${configuredUrl}`);
    const meta = await streamFsXml({
      url: configuredUrl,
      xmlSuffix: "ds_dsdd.xml",
      rootDateTag: "DatumAktualizacieZoznamu",
      logLabel: "tax_debtors",
      tempFilename: "preversi-tax-debtors.zip",
      onItem: (fields) => {
        const name = (fields.NAZOV_SUBJEKTU ?? "").trim();
        if (!name) return;
        const ulica = (fields.ULICA_CISLO ?? "").trim();
        const psc = (fields.PSC ?? "").trim();
        const obec = (fields.OBEC ?? "").trim();
        const addressRaw = [ulica, psc, obec].filter(Boolean).join(", ");
        records.push({
          nameRaw: name,
          addressRaw,
          psc: psc.replace(/\s/g, "") || null,
          obec: obec || null,
          amount: parseSkAmount(fields.CIASTKA ?? ""),
        });
      },
    });
    // eslint-disable-next-line no-console
    console.log(
      `[datahub] tax_debtors downloaded bytes=${meta.bytesRead} hash=${meta.contentHash.slice(0, 12)} items=${meta.itemCount}`,
    );
    if (meta.status !== 200) {
      return {
        status: "failed",
        sourceUrl: configuredUrl,
        contentHash: meta.contentHash || null,
        sourceRecordDate: null,
        recordsDownloaded: records.length,
        records: [],
        errorMessage: `HTTP ${meta.status} pri sťahovaní datasetu.`,
      };
    }
    return {
      status: "success",
      sourceUrl: configuredUrl,
      contentHash: meta.contentHash,
      sourceRecordDate: toIsoDate(meta.rootDate),
      recordsDownloaded: records.length,
      records,
      errorMessage: null,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[datahub] tax_debtors download error",
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
    return {
      status: "failed",
      sourceUrl: configuredUrl,
      contentHash: null,
      sourceRecordDate: null,
      recordsDownloaded: 0,
      records: [],
      errorMessage: `Sťahovanie/parsovanie zlyhalo: ${err instanceof Error ? err.message : "neznáma chyba"}`,
    };
  }
}
