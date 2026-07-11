// Server-only orchestrator for Financial Administration imports.
// Same lifecycle as insurance-debt.server.ts:
//   run row → importer → validation → staging → RPC reconcile → monitoring.
// The reconcile RPC uses pg_try_advisory_xact_lock so the same dataset cannot
// reconcile twice concurrently, and runs inside a single transaction.
// Records that vanish from the new dataset are ONLY marked is_current=false
// with removed_at=now(); nothing is permanently deleted.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  TAX_DATASETS,
  type TaxDatasetId,
  type TaxImporterOutcome,
} from "@/lib/tax-status.types";
import { downloadTaxDebtors } from "@/lib/providers/tax-debtors.provider.server";
import { matchAndReconcileTaxDebtors } from "@/lib/tax-debt-match.server";
import {
  importVatRegister,
  importVatRegisterStreamed,
} from "@/lib/providers/vat-register.provider.server";
import { importTaxReliability } from "@/lib/providers/tax-reliability.provider.server";
import {
  TAX_THRESHOLDS,
  cleanupStaging,
  reconcileTax,
  shortHash,
  stageTax,
  validateTax,
} from "@/lib/reconcile.server";
import {
  reportProgress,
  type ProgressCtx,
} from "@/lib/import-progress.server";

function admin(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

function datasetLogLabel(dataset: TaxDatasetId): string {
  return dataset === "vat_registered"
    ? "VAT"
    : dataset === "tax_debtors"
      ? "tax_debtors"
      : dataset;
}

function logImport(dataset: TaxDatasetId, message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[datahub] ${datasetLogLabel(dataset)} ${message}`);
}

function logImportError(dataset: TaxDatasetId, message: string, err?: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    `[datahub] ${datasetLogLabel(dataset)} ${message}`,
    err instanceof Error ? (err.stack ?? err.message) : (err ?? ""),
  );
}

async function writeFreshness(
  dataset: TaxDatasetId,
  ok: boolean,
  message: string | null,
  statusOverride?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const status = statusOverride ?? (ok ? "success" : "failed");
  await admin()
    .from("data_freshness")
    .upsert(
      {
        ico: "__GLOBAL__",
        source: `fs_${dataset}`,
        last_attempt_at: now,
        last_success_at: ok ? now : undefined,
        status,
        error_message: message,
        updated_at: now,
      },
      { onConflict: "ico,source" },
    );
}

async function latestSuccessHash(dataset: TaxDatasetId): Promise<string | null> {
  const { data } = await admin()
    .from("tax_import_runs")
    .select("content_hash")
    .eq("dataset", dataset)
    .in("status", ["success", "empty", "unchanged"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { content_hash: string | null } | null)?.content_hash ?? null;
}

async function insertRunRow(
  dataset: TaxDatasetId,
  startedAt: Date,
): Promise<string | null> {
  const { data, error } = await admin()
    .from("tax_import_runs")
    .insert({
      dataset,
      status: "running",
      started_at: startedAt.toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

interface RunUpdate {
  status?: string;
  source_url?: string | null;
  content_hash?: string | null;
  previous_source_hash?: string | null;
  source_record_date?: string | null;
  records_downloaded?: number;
  records_normalized?: number;
  records_with_valid_ico?: number;
  records_valid?: number;
  records_invalid?: number;
  records_inserted?: number;
  records_updated?: number;
  records_unchanged?: number;
  records_deactivated?: number;
  validation_status?: string | null;
  error_message?: string | null;
  finished_at?: string;
}

async function updateRunRow(runId: string, patch: RunUpdate): Promise<void> {
  await admin().from("tax_import_runs").update(patch).eq("id", runId);
}

// ---------- change detection ----------

interface WatchedSnapshot {
  hash: string | null;
  taxDebtAmount: number | null;
  vatRegistered: boolean | null;
  reliability: string | null;
}

const CHANGE_BATCH_SIZE = 1000;
const WATCHED_PAGE_SIZE = 1000;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function fetchWatchedIcos(dataset: TaxDatasetId, phase: string): Promise<string[]> {
  const out = new Set<string>();
  let afterIco: string | null = null;
  for (let page = 1; page <= 10000; page++) {
    logImport(dataset, `changes ${phase} watched page ${page}`);
    let query = admin()
      .from("watched_companies")
      .select("ico")
      .order("ico", { ascending: true })
      .limit(WATCHED_PAGE_SIZE);
    if (afterIco) query = query.gt("ico", afterIco);

    const { data, error } = await query;
    if (error) throw new Error(`watched companies page ${page}: ${error.message}`);
    const rows = (data as Array<{ ico: string }> | null) ?? [];
    if (rows.length === 0) return [...out];
    for (const row of rows) out.add(row.ico);
    afterIco = rows[rows.length - 1]?.ico ?? null;
    if (rows.length < WATCHED_PAGE_SIZE || !afterIco) return [...out];
  }
  throw new Error("watched companies exceeded safety page cap");
}

async function snapshotWatched(
  dataset: TaxDatasetId,
): Promise<Map<string, WatchedSnapshot>> {
  const icos = await fetchWatchedIcos(dataset, "snapshot");
  const out = new Map<string, WatchedSnapshot>();
  if (icos.length === 0) return out;
  const icoChunks = chunkArray(icos, CHANGE_BATCH_SIZE);
  for (let i = 0; i < icoChunks.length; i++) {
    logImport(dataset, `changes snapshot batch ${i + 1}/${icoChunks.length}`);
    const { data } = await admin()
      .from("company_tax_status")
      .select(
        "ico, source_record_hash, tax_debt_amount, vat_registered, tax_reliability_index",
      )
      .eq("source_dataset", dataset)
      .eq("is_current", true)
      .in("ico", icoChunks[i]);
    for (const row of (data as Array<{
      ico: string;
      source_record_hash: string | null;
      tax_debt_amount: number | null;
      vat_registered: boolean | null;
      tax_reliability_index: string | null;
    }> | null) ?? []) {
      out.set(row.ico, {
        hash: row.source_record_hash,
        taxDebtAmount: row.tax_debt_amount,
        vatRegistered: row.vat_registered,
        reliability: row.tax_reliability_index,
      });
    }
  }
  return out;
}

async function emitChanges(
  dataset: TaxDatasetId,
  prev: Map<string, WatchedSnapshot>,
): Promise<void> {
  const watchedIcos = await fetchWatchedIcos(dataset, "current");
  if (watchedIcos.length === 0) return;

  const curMap = new Map<string, WatchedSnapshot>();
  const icoChunks = chunkArray(watchedIcos, CHANGE_BATCH_SIZE);
  for (let i = 0; i < icoChunks.length; i++) {
    logImport(dataset, `changes current batch ${i + 1}/${icoChunks.length}`);
    const { data: nowCurrent } = await admin()
      .from("company_tax_status")
      .select(
        "ico, source_record_hash, tax_debt_amount, vat_registered, tax_reliability_index",
      )
      .eq("source_dataset", dataset)
      .eq("is_current", true)
      .in("ico", icoChunks[i]);

    for (const row of (nowCurrent as Array<{
      ico: string;
      source_record_hash: string | null;
      tax_debt_amount: number | null;
      vat_registered: boolean | null;
      tax_reliability_index: string | null;
    }> | null) ?? []) {
      curMap.set(row.ico, {
        hash: row.source_record_hash,
        taxDebtAmount: row.tax_debt_amount,
        vatRegistered: row.vat_registered,
        reliability: row.tax_reliability_index,
      });
    }
  }

  const changes: Array<{
    ico: string;
    change_type: string;
    title: string;
    description: string;
    severity: string;
  }> = [];

  if (dataset === "tax_debtors") {
    for (const [ico, cur] of curMap) {
      const before = prev.get(ico);
      if (!before) {
        changes.push({
          ico,
          change_type: "tax_debt_added",
          title: "Nový daňový nedoplatok",
          description:
            cur.taxDebtAmount != null
              ? `Firma bola pridaná do zoznamu daňových dlžníkov (dlh: ${cur.taxDebtAmount.toFixed(2)} €).`
              : "Firma bola pridaná do zoznamu daňových dlžníkov.",
          severity:
            cur.taxDebtAmount != null && cur.taxDebtAmount >= 1000
              ? "critical"
              : "warning",
        });
      } else if (before.hash !== cur.hash) {
        changes.push({
          ico,
          change_type: "tax_debt_amount_changed",
          title: "Zmena výšky daňového nedoplatku",
          description: `Predtým ${before.taxDebtAmount ?? "n/a"} €, aktuálne ${cur.taxDebtAmount ?? "n/a"} €.`,
          severity: "warning",
        });
      }
    }
    for (const [ico] of prev) {
      if (!curMap.has(ico)) {
        changes.push({
          ico,
          change_type: "tax_debt_removed_from_published_list",
          title: "Firma odstránená zo zoznamu daňových dlžníkov",
          description:
            "Firma už nie je uvedená v aktuálnom zverejnenom zozname daňových dlžníkov.",
          severity: "info",
        });
      }
    }
  } else if (dataset === "vat_registered") {
    for (const [ico, cur] of curMap) {
      const before = prev.get(ico);
      if (!before && cur.vatRegistered === true) {
        changes.push({
          ico,
          change_type: "vat_registration_added",
          title: "Zaregistrovaný ako platiteľ DPH",
          description: "Firma je uvedená v registri platiteľov DPH.",
          severity: "info",
        });
      } else if (before?.vatRegistered === true && cur.vatRegistered === false) {
        changes.push({
          ico,
          change_type: "vat_registration_removed",
          title: "Zrušená registrácia DPH",
          description:
            "Podľa oficiálneho zdroja Finančnej správy bola registrácia DPH zrušená.",
          severity: "warning",
        });
      }
    }
    for (const [ico, before] of prev) {
      if (!curMap.has(ico) && before.vatRegistered === true) {
        changes.push({
          ico,
          change_type: "vat_registration_removed",
          title: "Odstránené zo zverejneného registra DPH",
          description:
            "Firma už nie je uvedená v aktuálnom zverejnenom registri platiteľov DPH.",
          severity: "warning",
        });
      }
    }
  } else if (dataset === "tax_reliability") {
    for (const [ico, cur] of curMap) {
      const before = prev.get(ico);
      if (cur.reliability && before?.reliability !== cur.reliability) {
        changes.push({
          ico,
          change_type: "tax_reliability_changed",
          title: "Zmena indexu daňovej spoľahlivosti",
          description: `Nová hodnota: ${cur.reliability}${before?.reliability ? ` (predtým: ${before.reliability}).` : "."}`,
          severity: "info",
        });
      }
    }
  }

  const changeChunks = chunkArray(changes, CHANGE_BATCH_SIZE);
  for (let i = 0; i < changeChunks.length; i++) {
    logImport(dataset, `changes insert batch ${i + 1}/${changeChunks.length} rows=${changeChunks[i].length}`);
    await admin().from("company_changes").insert(changeChunks[i]);
  }
}

// ---------- main flow ----------

function runImporterFor(dataset: TaxDatasetId): Promise<TaxImporterOutcome> {
  switch (dataset) {
    case "tax_debtors":
      throw new Error("tax_debtors uses the matching pipeline, not runImporterFor");
    case "vat_registered":
      return importVatRegister();
    case "tax_reliability":
      return importTaxReliability();
  }
}

async function importTaxDebtorsMatchingFlow(
  runId: string,
  progress: ProgressCtx | null,
): Promise<TaxDatasetImportResult> {
  const dataset: TaxDatasetId = "tax_debtors";
  logImport(dataset, `start matching-flow run=${runId}`);
  await reportProgress(progress, { phase: "download", message: "Sťahovanie zoznamu dlžníkov" });

  const outcome = await downloadTaxDebtors();
  const common: RunUpdate = {
    source_url: outcome.sourceUrl,
    content_hash: outcome.contentHash,
    source_record_date: outcome.sourceRecordDate,
    records_downloaded: outcome.recordsDownloaded,
    records_normalized: outcome.recordsDownloaded,
    records_with_valid_ico: 0,
  };
  logImport(dataset, `downloaded records=${outcome.recordsDownloaded} status=${outcome.status}`);

  if (outcome.status !== "success") {
    const st = outcome.status === "not_configured" ? "not_implemented" : "failed";
    await updateRunRow(runId, {
      ...common,
      status: st,
      error_message: outcome.errorMessage,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(dataset, false, outcome.errorMessage);
    await reportProgress(progress, { phase: "failed", message: outcome.errorMessage ?? st });
    return {
      dataset,
      status: st,
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: outcome.errorMessage,
    };
  }

  const sourceDate = outcome.sourceRecordDate ?? new Date().toISOString().slice(0, 10);
  await reportProgress(progress, { phase: "reconciliation", message: "Párovanie záznamov" });
  const match = await matchAndReconcileTaxDebtors(
    admin(),
    runId,
    outcome.records,
    sourceDate,
    progress,
  );

  if (match.errorMessage) {
    await updateRunRow(runId, {
      ...common,
      status: "failed",
      validation_status: "failed",
      error_message: `Párovanie zlyhalo: ${match.errorMessage}`,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(dataset, false, match.errorMessage);
    await reportProgress(progress, {
      phase: "failed",
      message: `Párovanie zlyhalo: ${match.errorMessage}`,
    });
    return {
      dataset,
      status: "failed",
      recordsInserted: match.inserted,
      recordsUpdated: match.updated,
      recordsUnchanged: match.unchanged,
      recordsDeactivated: match.deactivated,
      errorMessage: match.errorMessage,
    };
  }

  const stats = `total=${match.totalRecords} exact=${match.matchedExact} fuzzy=${match.matchedFuzzy} manual=${match.matchedManual} unmatched=${match.unmatched}`;
  logImport(dataset, `matching done ${stats} inserted=${match.inserted} updated=${match.updated} unchanged=${match.unchanged} deactivated=${match.deactivated}`);

  await updateRunRow(runId, {
    ...common,
    status: "success_partial",
    validation_status: "passed",
    records_valid: match.matchedExact + match.matchedFuzzy + match.matchedManual,
    records_invalid: match.unmatched,
    records_inserted: match.inserted,
    records_updated: match.updated,
    records_unchanged: match.unchanged,
    records_deactivated: match.deactivated,
    error_message: `Info: Zdroj FS neobsahuje IČO. Priradených ${match.matchedExact + match.matchedFuzzy + match.matchedManual} / ${match.totalRecords} záznamov (exact=${match.matchedExact}, fuzzy=${match.matchedFuzzy}, manual=${match.matchedManual}, unmatched=${match.unmatched}).`,
    finished_at: new Date().toISOString(),
  });
  await writeFreshness(
    dataset,
    true,
    `Priradené ${match.matchedExact + match.matchedFuzzy + match.matchedManual}/${match.totalRecords}. Nepriradené: ${match.unmatched}.`,
    "success_partial",
  );
  await reportProgress(progress, {
    phase: "done",
    message: `Hotovo: ${stats}`,
    recordsProcessed: match.matchedExact + match.matchedFuzzy + match.matchedManual,
    recordsTotal: match.totalRecords,
  });
  return {
    dataset,
    status: "success_partial",
    recordsInserted: match.inserted,
    recordsUpdated: match.updated,
    recordsUnchanged: match.unchanged,
    recordsDeactivated: match.deactivated,
    errorMessage: null,
  };
}

export interface TaxDatasetImportResult {
  dataset: TaxDatasetId;
  status?: string;
  recordsInserted: number;
  recordsUpdated: number;
  recordsUnchanged: number;
  recordsDeactivated: number;
  errorMessage: string | null;
}

async function importVatStreamedFlow(
  runId: string,
  progress: ProgressCtx | null,
): Promise<TaxDatasetImportResult> {
  logImport("vat_registered", `start run=${runId}`);
  await reportProgress(progress, {
    phase: "download",
    message: "Sťahovanie a streamovanie do stagingu",
  });
  const prevHash = await latestSuccessHash("vat_registered");
  const prevSnapshot = await snapshotWatched("vat_registered");
  const summary = await importVatRegisterStreamed(admin(), runId, 1000, progress);
  logImport(
    "vat_registered",
    `downloaded bytes=${summary.bytesRead} hash=${shortHash(summary.contentHash)} records=${summary.recordsDownloaded} staged=${summary.recordsStaged}`,
  );
  logImport(
    "vat_registered",
    `downloaded bytes=${summary.bytesRead} hash=${shortHash(summary.contentHash)} records=${summary.recordsDownloaded} staged=${summary.recordsStaged}`,
  );

  const commonUpdate: RunUpdate = {
    source_url: summary.sourceUrl,
    content_hash: summary.contentHash || null,
    previous_source_hash: prevHash,
    source_record_date: summary.sourceRecordDate,
    records_downloaded: summary.recordsDownloaded,
    records_normalized: summary.recordsNormalized,
    records_with_valid_ico: summary.recordsWithValidIco,
  };

  if (summary.errorMessage) {
    logImportError("vat_registered", `stream/staging failed: ${summary.errorMessage}`);
    await cleanupStaging(admin(), "staging_tax_records", runId);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: "failed",
      validation_status: "failed",
      error_message: summary.errorMessage,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness("vat_registered", false, summary.errorMessage);
    await reportProgress(progress, { phase: "failed", message: summary.errorMessage });
    return {
      dataset: "vat_registered",
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: summary.errorMessage,
    };
  }

  // Unchanged shortcut — same source hash as last successful run.
  if (summary.contentHash && prevHash && summary.contentHash === prevHash) {
    logImport("vat_registered", `validation skipped unchanged hash=${shortHash(summary.contentHash)}`);
    await cleanupStaging(admin(), "staging_tax_records", runId);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: "unchanged",
      validation_status: "skipped",
      finished_at: new Date().toISOString(),
    });
    await writeFreshness("vat_registered", true, "Dataset nezmenený od posledného behu.");
    await reportProgress(progress, {
      phase: "done",
      message: "Dataset nezmenený od posledného behu.",
    });
    return {
      dataset: "vat_registered",
      status: "unchanged",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: null,
    };
  }

  // Validation gate — required columns and sanity thresholds.
  const th = TAX_THRESHOLDS.vat_registered;
  const invalid = summary.recordsDownloaded - summary.recordsWithValidIco;
  const validRatio =
    summary.recordsDownloaded > 0
      ? summary.recordsWithValidIco / summary.recordsDownloaded
      : 0;

  const missingCols: string[] = [];
  if (!summary.sampleColumnNames.includes("ICO")) missingCols.push("ICO");
  if (!summary.sampleColumnNames.includes("IC_DPH")) missingCols.push("IC_DPH");

  let validationError: string | null = null;
  if (missingCols.length > 0) {
    validationError = `Zdroj neobsahuje povinné polia: ${missingCols.join(", ")}.`;
  } else if (summary.recordsStaged < th.minRecords) {
    validationError = `Dataset obsahuje príliš málo záznamov s platným IČO (${summary.recordsStaged} < ${th.minRecords}).`;
  } else if (summary.recordsDownloaded > 0 && validRatio < th.minValidIcoRatio) {
    validationError = `Podiel záznamov s platným IČO je nízky (${(validRatio * 100).toFixed(1)}%).`;
  } else if (summary.duplicateRatio > th.maxDuplicateRatio) {
    validationError = `Podiel duplicít je vysoký (${(summary.duplicateRatio * 100).toFixed(1)}%). Zdroj vyzerá poškodený.`;
  }

  await reportProgress(progress, { phase: "validation", message: "Validácia dát" });
  logImport(
    "vat_registered",
    `validation ok=${!validationError} valid=${summary.recordsWithValidIco} invalid=${invalid} duplicateRatio=${summary.duplicateRatio.toFixed(4)}`,
  );

  if (validationError) {
    logImportError("vat_registered", `validation failed: ${validationError}`);
    await cleanupStaging(admin(), "staging_tax_records", runId);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: "failed",
      validation_status: "failed",
      records_valid: summary.recordsWithValidIco,
      records_invalid: invalid,
      error_message: validationError,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness("vat_registered", false, validationError);
    await reportProgress(progress, { phase: "failed", message: validationError });
    return {
      dataset: "vat_registered",
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: validationError,
    };
  }

  const sourceDate = summary.sourceRecordDate ?? new Date().toISOString().slice(0, 10);
  const rec = await reconcileTax(admin(), "vat_registered", runId, sourceDate, progress);
  if (rec.errorMessage || !rec.counts) {
    logImportError("vat_registered", `reconciliation failed: ${rec.errorMessage ?? "unknown"}`);
    await cleanupStaging(admin(), "staging_tax_records", runId);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: "failed",
      validation_status: "failed",
      records_valid: summary.recordsWithValidIco,
      records_invalid: invalid,
      error_message: `Reconciliation zlyhal: ${rec.errorMessage ?? "unknown"}`,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness("vat_registered", false, rec.errorMessage);
    await reportProgress(progress, {
      phase: "failed",
      message: `Reconciliation zlyhal: ${rec.errorMessage ?? "unknown"}`,
    });
    return {
      dataset: "vat_registered",
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: rec.errorMessage,
    };
  }

  try {
    await emitChanges("vat_registered", prevSnapshot);
  } catch {
    /* ignored */
  }

  await updateRunRow(runId, {
    ...commonUpdate,
    status: "success",
    validation_status: "passed",
    records_valid: summary.recordsWithValidIco,
    records_invalid: invalid,
    records_inserted: rec.counts.inserted,
    records_updated: rec.counts.updated,
    records_unchanged: rec.counts.unchanged,
    records_deactivated: rec.counts.deactivated,
    finished_at: new Date().toISOString(),
  });
  await writeFreshness("vat_registered", true, null);
  logImport(
    "vat_registered",
    `final status=success inserted=${rec.counts.inserted} updated=${rec.counts.updated} unchanged=${rec.counts.unchanged} deactivated=${rec.counts.deactivated}`,
  );
  await reportProgress(progress, {
    phase: "done",
    message: `Hotovo: +${rec.counts.inserted} / ~${rec.counts.updated} / =${rec.counts.unchanged} / −${rec.counts.deactivated}`,
    recordsProcessed:
      rec.counts.inserted + rec.counts.updated + rec.counts.unchanged,
  });

  return {
    dataset: "vat_registered",
    status: "success",
    recordsInserted: rec.counts.inserted,
    recordsUpdated: rec.counts.updated,
    recordsUnchanged: rec.counts.unchanged,
    recordsDeactivated: rec.counts.deactivated,
    errorMessage: null,
  };
}

export async function importOneDataset(
  dataset: TaxDatasetId,
  globalRunId?: string,
): Promise<TaxDatasetImportResult> {
  const progress: ProgressCtx | null = globalRunId
    ? { admin: admin(), runId: globalRunId, source: `fs_${dataset}` }
    : null;
  const startedAt = new Date();
  const runId = await insertRunRow(dataset, startedAt);
  if (!runId) {
    const msg = "Nepodarilo sa vytvoriť záznam behu.";
    logImportError(dataset, msg);
    await writeFreshness(dataset, false, msg);
    return {
      dataset,
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: msg,
    };
  }

  // VAT register is streamed directly into staging (dataset is ~125 MB
  // uncompressed and cannot be buffered).
  if (dataset === "vat_registered") {
    try {
      return await importVatStreamedFlow(runId, progress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Neznáma chyba importu.";
      logImportError(dataset, "streamed flow crashed", err);
      await cleanupStaging(admin(), "staging_tax_records", runId);
      await updateRunRow(runId, {
        status: "failed",
        error_message: msg,
        finished_at: new Date().toISOString(),
      });
      await writeFreshness(dataset, false, msg);
      await reportProgress(progress, { phase: "failed", message: msg });
      return {
        dataset,
        status: "failed",
        recordsInserted: 0,
        recordsUpdated: 0,
        recordsUnchanged: 0,
        recordsDeactivated: 0,
        errorMessage: msg,
      };
    }
  }

  let outcome: TaxImporterOutcome;
  try {
    logImport(dataset, `start run=${runId}`);
    await reportProgress(progress, { phase: "download", message: "Sťahovanie zdroja" });
    outcome = await runImporterFor(dataset);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznáma chyba importu.";
    logImportError(dataset, "importer crashed", err);
    await updateRunRow(runId, {
      status: "failed",
      error_message: msg,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(dataset, false, msg);
    await reportProgress(progress, { phase: "failed", message: msg });
    return {
      dataset,
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: msg,
    };
  }

  const commonUpdate: RunUpdate = {
    source_url: outcome.sourceUrl,
    content_hash: outcome.contentHash,
    source_record_date: outcome.sourceRecordDate,
    records_downloaded: outcome.recordsDownloaded,
    records_normalized: outcome.recordsNormalized,
    records_with_valid_ico: outcome.recordsWithValidIco,
  };
  logImport(
    dataset,
    `downloaded records=${outcome.recordsDownloaded} hash=${shortHash(outcome.contentHash)} status=${outcome.status}`,
  );

  if (outcome.status === "not_implemented" || outcome.status === "failed") {
    logImportError(dataset, `failed before validation: ${outcome.errorMessage ?? "unknown"}`);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: outcome.status,
      error_message: outcome.errorMessage,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(dataset, false, outcome.errorMessage);
    await reportProgress(progress, {
      phase: "failed",
      message: outcome.errorMessage ?? outcome.status,
    });
    return {
      dataset,
      status: outcome.status,
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: outcome.errorMessage,
    };
  }

  const prevHash = await latestSuccessHash(dataset);
  if (outcome.contentHash && prevHash && outcome.contentHash === prevHash) {
    logImport(dataset, `validation skipped unchanged hash=${shortHash(outcome.contentHash)}`);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: "unchanged",
      previous_source_hash: prevHash,
      validation_status: "skipped",
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(dataset, true, "Dataset nezmenený od posledného behu.");
    await reportProgress(progress, {
      phase: "done",
      message: "Dataset nezmenený od posledného behu.",
    });
    return {
      dataset,
      status: "unchanged",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: null,
    };
  }

  await reportProgress(progress, { phase: "validation", message: "Validácia dát" });
  const validation = validateTax(outcome.records, dataset);
  logImport(
    dataset,
    `validation ok=${validation.ok} valid=${validation.validCount} invalid=${validation.invalidCount} duplicateRatio=${validation.duplicateRatio.toFixed(4)}`,
  );
  if (!validation.ok) {
    logImportError(dataset, `validation failed: ${validation.reason ?? "unknown"}`);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: "failed",
      previous_source_hash: prevHash,
      validation_status: "failed",
      records_valid: validation.validCount,
      records_invalid: validation.invalidCount,
      error_message: validation.reason,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(dataset, false, validation.reason);
    await reportProgress(progress, {
      phase: "failed",
      message: validation.reason ?? "Validácia zlyhala",
    });
    return {
      dataset,
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: validation.reason,
    };
  }

  const prevSnapshot = await snapshotWatched(dataset);

  const staged = await stageTax(
    admin(),
    outcome.records,
    runId,
    datasetLogLabel(dataset),
    progress,
  );
  if (staged.errorMessage) {
    logImportError(dataset, `staging failed after ${staged.staged} rows: ${staged.errorMessage}`);
    await cleanupStaging(admin(), "staging_tax_records", runId);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: "failed",
      previous_source_hash: prevHash,
      validation_status: "failed",
      records_valid: validation.validCount,
      records_invalid: validation.invalidCount,
      error_message: `Staging chyba: ${staged.errorMessage}`,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(dataset, false, staged.errorMessage);
    await reportProgress(progress, {
      phase: "failed",
      message: `Staging chyba: ${staged.errorMessage}`,
    });
    return {
      dataset,
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: staged.errorMessage,
    };
  }

  const sourceDate = outcome.sourceRecordDate ?? new Date().toISOString().slice(0, 10);
  const rec = await reconcileTax(admin(), dataset, runId, sourceDate, progress);
  if (rec.errorMessage || !rec.counts) {
    logImportError(dataset, `reconciliation failed: ${rec.errorMessage ?? "unknown"}`);
    await cleanupStaging(admin(), "staging_tax_records", runId);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: "failed",
      previous_source_hash: prevHash,
      validation_status: "failed",
      records_valid: validation.validCount,
      records_invalid: validation.invalidCount,
      error_message: `Reconciliation zlyhal: ${rec.errorMessage ?? "unknown"}`,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(dataset, false, rec.errorMessage);
    await reportProgress(progress, {
      phase: "failed",
      message: `Reconciliation zlyhal: ${rec.errorMessage ?? "unknown"}`,
    });
    return {
      dataset,
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: rec.errorMessage,
    };
  }

  try {
    await emitChanges(dataset, prevSnapshot);
  } catch {
    /* ignored */
  }

  await updateRunRow(runId, {
    ...commonUpdate,
    status: "success",
    previous_source_hash: prevHash,
    validation_status: "passed",
    records_valid: validation.validCount,
    records_invalid: validation.invalidCount,
    records_inserted: rec.counts.inserted,
    records_updated: rec.counts.updated,
    records_unchanged: rec.counts.unchanged,
    records_deactivated: rec.counts.deactivated,
    finished_at: new Date().toISOString(),
  });
  await writeFreshness(dataset, true, null);
  logImport(
    dataset,
    `final status=success inserted=${rec.counts.inserted} updated=${rec.counts.updated} unchanged=${rec.counts.unchanged} deactivated=${rec.counts.deactivated}`,
  );
  await reportProgress(progress, {
    phase: "done",
    message: `Hotovo: +${rec.counts.inserted} / ~${rec.counts.updated} / =${rec.counts.unchanged} / −${rec.counts.deactivated}`,
    recordsProcessed:
      rec.counts.inserted + rec.counts.updated + rec.counts.unchanged,
  });

  return {
    dataset,
    status: "success",
    recordsInserted: rec.counts.inserted,
    recordsUpdated: rec.counts.updated,
    recordsUnchanged: rec.counts.unchanged,
    recordsDeactivated: rec.counts.deactivated,
    errorMessage: null,
  };
}

export async function importTaxDebtorsGlobal(): Promise<TaxDatasetImportResult> {
  return importOneDataset("tax_debtors");
}
export async function importVatRegisterGlobal(): Promise<TaxDatasetImportResult> {
  return importOneDataset("vat_registered");
}
export async function importTaxReliabilityGlobal(): Promise<TaxDatasetImportResult> {
  return importOneDataset("tax_reliability");
}

export async function importAllFinancialAdministrationData(): Promise<
  TaxDatasetImportResult[]
> {
  const results: TaxDatasetImportResult[] = [];
  for (const d of TAX_DATASETS) {
    try {
      results.push(await importOneDataset(d));
    } catch (err) {
      logImportError(d, "dataset wrapper crashed", err);
      await writeFreshness(
        d,
        false,
        err instanceof Error ? err.message : "Neznáma chyba.",
      );
      results.push({
        dataset: d,
        status: "failed",
        recordsInserted: 0,
        recordsUpdated: 0,
        recordsUnchanged: 0,
        recordsDeactivated: 0,
        errorMessage: err instanceof Error ? err.message : "Neznáma chyba.",
      });
    }
  }
  return results;
}

export const GLOBAL_JOB_ICO = "__GLOBAL__";
