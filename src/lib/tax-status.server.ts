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
import { importTaxDebtors } from "@/lib/providers/tax-debtors.provider.server";
import {
  importVatRegister,
  importVatRegisterStreamed,
} from "@/lib/providers/vat-register.provider.server";
import { importTaxReliability } from "@/lib/providers/tax-reliability.provider.server";
import {
  TAX_THRESHOLDS,
  cleanupStaging,
  reconcileTax,
  stageTax,
  validateTax,
} from "@/lib/reconcile.server";

function admin(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

async function writeFreshness(
  dataset: TaxDatasetId,
  ok: boolean,
  message: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await admin()
    .from("data_freshness")
    .upsert(
      {
        ico: "__GLOBAL__",
        source: `fs_${dataset}`,
        last_attempt_at: now,
        last_success_at: ok ? now : undefined,
        status: ok ? "success" : "failed",
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

async function snapshotWatched(
  dataset: TaxDatasetId,
): Promise<Map<string, WatchedSnapshot>> {
  const { data: watched } = await admin().from("watched_companies").select("ico");
  const icos = ((watched as Array<{ ico: string }> | null) ?? []).map((w) => w.ico);
  const out = new Map<string, WatchedSnapshot>();
  if (icos.length === 0) return out;
  const { data } = await admin()
    .from("company_tax_status")
    .select(
      "ico, source_record_hash, tax_debt_amount, vat_registered, tax_reliability_index",
    )
    .eq("source_dataset", dataset)
    .eq("is_current", true)
    .in("ico", icos);
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
  return out;
}

async function emitChanges(
  dataset: TaxDatasetId,
  prev: Map<string, WatchedSnapshot>,
): Promise<void> {
  const { data: watched } = await admin().from("watched_companies").select("ico");
  const watchedIcos = ((watched as Array<{ ico: string }> | null) ?? []).map((w) => w.ico);
  if (watchedIcos.length === 0) return;

  const { data: nowCurrent } = await admin()
    .from("company_tax_status")
    .select(
      "ico, source_record_hash, tax_debt_amount, vat_registered, tax_reliability_index",
    )
    .eq("source_dataset", dataset)
    .eq("is_current", true)
    .in("ico", watchedIcos);

  const curMap = new Map<string, WatchedSnapshot>();
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

  if (changes.length > 0) {
    await admin().from("company_changes").insert(changes);
  }
}

// ---------- main flow ----------

function runImporterFor(dataset: TaxDatasetId): Promise<TaxImporterOutcome> {
  switch (dataset) {
    case "tax_debtors":
      return importTaxDebtors();
    case "vat_registered":
      return importVatRegister();
    case "tax_reliability":
      return importTaxReliability();
  }
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
): Promise<TaxDatasetImportResult> {
  const prevHash = await latestSuccessHash("vat_registered");
  const prevSnapshot = await snapshotWatched("vat_registered");
  const summary = await importVatRegisterStreamed(admin(), runId);

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
    await cleanupStaging(admin(), "staging_tax_records", runId);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: "failed",
      validation_status: "failed",
      error_message: summary.errorMessage,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness("vat_registered", false, summary.errorMessage);
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
    await cleanupStaging(admin(), "staging_tax_records", runId);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: "unchanged",
      validation_status: "skipped",
      finished_at: new Date().toISOString(),
    });
    await writeFreshness("vat_registered", true, "Dataset nezmenený od posledného behu.");
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

  if (validationError) {
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
  const rec = await reconcileTax(admin(), "vat_registered", runId, sourceDate);
  if (rec.errorMessage || !rec.counts) {
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
): Promise<TaxDatasetImportResult> {
  const startedAt = new Date();
  const runId = await insertRunRow(dataset, startedAt);
  if (!runId) {
    return {
      dataset,
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: "Nepodarilo sa vytvoriť záznam behu.",
    };
  }

  // VAT register is streamed directly into staging (dataset is ~125 MB
  // uncompressed and cannot be buffered).
  if (dataset === "vat_registered") {
    return importVatStreamedFlow(runId);
  }

  let outcome: TaxImporterOutcome;
  try {
    outcome = await runImporterFor(dataset);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznáma chyba importu.";
    await updateRunRow(runId, {
      status: "failed",
      error_message: msg,
      finished_at: new Date().toISOString(),
    });
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

  const commonUpdate: RunUpdate = {
    source_url: outcome.sourceUrl,
    content_hash: outcome.contentHash,
    source_record_date: outcome.sourceRecordDate,
    records_downloaded: outcome.recordsDownloaded,
    records_normalized: outcome.recordsNormalized,
    records_with_valid_ico: outcome.recordsWithValidIco,
  };

  if (outcome.status === "not_implemented" || outcome.status === "failed") {
    await updateRunRow(runId, {
      ...commonUpdate,
      status: outcome.status,
      error_message: outcome.errorMessage,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(dataset, false, outcome.errorMessage);
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
    await updateRunRow(runId, {
      ...commonUpdate,
      status: "unchanged",
      previous_source_hash: prevHash,
      validation_status: "skipped",
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(dataset, true, "Dataset nezmenený od posledného behu.");
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

  const validation = validateTax(outcome.records, dataset);
  if (!validation.ok) {
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

  const staged = await stageTax(admin(), outcome.records, runId);
  if (staged.errorMessage) {
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
  const rec = await reconcileTax(admin(), dataset, runId, sourceDate);
  if (rec.errorMessage || !rec.counts) {
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
