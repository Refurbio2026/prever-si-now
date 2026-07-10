// Shared reconciliation helpers for global DataHub imports.
// - Deterministic record hashing (SHA-256 over canonical fields).
// - Sanity-check validation gates BEFORE reconciliation touches production.
// - Staging insert + reconcile RPC dispatch (transactional in Postgres,
//   protected by pg_try_advisory_xact_lock inside each RPC).

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  InsuranceDebtRecord,
  InsuranceProviderId,
} from "@/lib/insurance-debt.types";
import type {
  TaxDatasetId,
  TaxStatusRecord,
} from "@/lib/tax-status.types";
import { reportProgress, type ProgressCtx } from "@/lib/import-progress.server";

// ---------- Hash ----------

function stableString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? v.toString() : "";
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v);
}

export function insuranceRecordHash(r: InsuranceDebtRecord): string {
  const parts = [
    r.provider,
    r.ico ?? "",
    stableString(r.debtAmount),
    r.currency,
    r.debtorName ?? "",
    r.address ?? "",
  ].join("|");
  return createHash("sha256").update(parts).digest("hex");
}

export function taxRecordHash(r: TaxStatusRecord): string {
  const parts = [
    r.dataset,
    r.ico ?? "",
    stableString(r.taxDebtorFound),
    stableString(r.taxDebtAmount),
    stableString(r.vatRegistered),
    r.icDph ?? "",
    r.vatRegistrationDate ?? "",
    r.taxReliabilityIndex ?? "",
  ].join("|");
  return createHash("sha256").update(parts).digest("hex");
}

// ---------- Validation gates ----------

export interface ValidationResult {
  ok: boolean;
  reason: string | null;
  validCount: number;
  invalidCount: number;
  duplicateRatio: number;
}

export interface DatasetThresholds {
  /** Minimum accepted record count for a "full dataset" to be trusted. */
  minRecords: number;
  /** Minimum ratio of records with a valid IČO (0..1). */
  minValidIcoRatio: number;
  /** Maximum duplicate-IČO ratio (0..1). */
  maxDuplicateRatio: number;
}

// Insurance thresholds — SP has thousands of debtors, others are stubbed.
export const INSURANCE_THRESHOLDS: Record<InsuranceProviderId, DatasetThresholds> = {
  social_insurance: { minRecords: 500, minValidIcoRatio: 0.4, maxDuplicateRatio: 0.6 },
  vszp: { minRecords: 1, minValidIcoRatio: 0.4, maxDuplicateRatio: 0.9 },
  dovera: { minRecords: 1, minValidIcoRatio: 0.4, maxDuplicateRatio: 0.9 },
  union: { minRecords: 1, minValidIcoRatio: 0.4, maxDuplicateRatio: 0.9 },
};

// Tax thresholds — VAT register is huge; debtors list smaller.
export const TAX_THRESHOLDS: Record<TaxDatasetId, DatasetThresholds> = {
  tax_debtors: { minRecords: 100, minValidIcoRatio: 0.7, maxDuplicateRatio: 0.5 },
  vat_registered: { minRecords: 10_000, minValidIcoRatio: 0.9, maxDuplicateRatio: 0.05 },
  tax_reliability: { minRecords: 1, minValidIcoRatio: 0.9, maxDuplicateRatio: 0.05 },
};

function validate(
  recordsWithIco: string[],
  totalNormalized: number,
  th: DatasetThresholds,
): ValidationResult {
  const validCount = recordsWithIco.length;
  const invalidCount = Math.max(totalNormalized - validCount, 0);
  const unique = new Set(recordsWithIco);
  const duplicateRatio =
    validCount > 0 ? (validCount - unique.size) / validCount : 0;
  const validRatio = totalNormalized > 0 ? validCount / totalNormalized : 0;

  if (validCount < th.minRecords) {
    return {
      ok: false,
      reason: `Dataset obsahuje príliš málo záznamov s platným IČO (${validCount} < ${th.minRecords}). Reconciliation zablokovaný.`,
      validCount,
      invalidCount,
      duplicateRatio,
    };
  }
  if (totalNormalized > 0 && validRatio < th.minValidIcoRatio) {
    return {
      ok: false,
      reason: `Podiel záznamov s platným IČO je nízky (${(validRatio * 100).toFixed(1)}%). Reconciliation zablokovaný.`,
      validCount,
      invalidCount,
      duplicateRatio,
    };
  }
  if (duplicateRatio > th.maxDuplicateRatio) {
    return {
      ok: false,
      reason: `Podiel duplicít je vysoký (${(duplicateRatio * 100).toFixed(1)}%). Zdroj vyzerá poškodený.`,
      validCount,
      invalidCount,
      duplicateRatio,
    };
  }
  return { ok: true, reason: null, validCount, invalidCount, duplicateRatio };
}

export function validateInsurance(
  records: InsuranceDebtRecord[],
  provider: InsuranceProviderId,
): ValidationResult {
  const icos = records
    .map((r) => r.ico)
    .filter((v): v is string => v !== null);
  return validate(icos, records.length, INSURANCE_THRESHOLDS[provider]);
}

export function validateTax(
  records: TaxStatusRecord[],
  dataset: TaxDatasetId,
): ValidationResult {
  const icos = records
    .map((r) => r.ico)
    .filter((v): v is string => v !== null);
  return validate(icos, records.length, TAX_THRESHOLDS[dataset]);
}

// ---------- Staging + reconcile ----------

const STAGING_BATCH = 1000;

function logDatahub(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[datahub] ${message}`);
}

function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 12) : "none";
}

export async function stageInsurance(
  admin: SupabaseClient,
  records: InsuranceDebtRecord[],
  runId: string,
  label = "insurance",
  progress?: ProgressCtx | null,
): Promise<{ staged: number; errorMessage: string | null }> {
  const seen = new Set<string>();
  const rows = records
    .filter((r) => r.ico !== null)
    .map((r) => ({
      ico: r.ico as string,
      provider: r.provider,
      debt_amount: r.debtAmount,
      currency: r.currency,
      debtor_name: r.debtorName,
      address: r.address,
      source_url: r.sourceUrl,
      raw_data: r.rawData,
      source_record_hash: insuranceRecordHash(r),
      run_id: runId,
    }))
    // Dedupe by (provider, ico): keep the first occurrence.
    .filter((r) => {
      const k = `${r.provider}|${r.ico}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  let staged = 0;
  const totalBatches = Math.max(1, Math.ceil(rows.length / STAGING_BATCH));
  await reportProgress(progress, {
    phase: "staging",
    currentBatch: 0,
    totalBatches,
    recordsProcessed: 0,
    recordsTotal: rows.length,
    message: `Staging ${rows.length} záznamov (${totalBatches} dávok)`,
  });
  for (let i = 0; i < rows.length; i += STAGING_BATCH) {
    const batchNo = Math.floor(i / STAGING_BATCH) + 1;
    const slice = rows.slice(i, i + STAGING_BATCH);
    const { error } = await admin.from("staging_insurance_debts").insert(slice);
    if (error) {
      logDatahub(`${label} staging batch ${batchNo}/${totalBatches} failed: ${error.message}`);
      await reportProgress(progress, {
        phase: "staging",
        currentBatch: batchNo,
        totalBatches,
        recordsProcessed: staged,
        recordsTotal: rows.length,
        message: `Staging dávka ${batchNo}/${totalBatches} zlyhala: ${error.message}`,
      });
      return { staged, errorMessage: error.message };
    }
    staged += slice.length;
    logDatahub(`${label} staging batch ${batchNo}/${totalBatches} rows=${slice.length} staged=${staged}`);
    await reportProgress(progress, {
      phase: "staging",
      currentBatch: batchNo,
      totalBatches,
      recordsProcessed: staged,
      recordsTotal: rows.length,
      message: `Staging dávka ${batchNo}/${totalBatches}`,
    });
  }
  return { staged, errorMessage: null };
}

export async function stageTax(
  admin: SupabaseClient,
  records: TaxStatusRecord[],
  runId: string,
  label = "tax",
  progress?: ProgressCtx | null,
): Promise<{ staged: number; errorMessage: string | null }> {
  const seen = new Set<string>();
  const rows = records
    .filter((r) => r.ico !== null)
    .map((r) => ({
      ico: r.ico as string,
      dataset: r.dataset,
      tax_debtor_found: r.taxDebtorFound,
      tax_debt_amount: r.taxDebtAmount,
      vat_registered: r.vatRegistered,
      ic_dph: r.icDph,
      vat_registration_date: r.vatRegistrationDate,
      tax_reliability_index: r.taxReliabilityIndex,
      source_url: r.sourceUrl,
      raw_data: r.rawData,
      source_record_hash: taxRecordHash(r),
      run_id: runId,
    }))
    .filter((r) => {
      const k = `${r.dataset}|${r.ico}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  let staged = 0;
  const totalBatches = Math.max(1, Math.ceil(rows.length / STAGING_BATCH));
  await reportProgress(progress, {
    phase: "staging",
    currentBatch: 0,
    totalBatches,
    recordsProcessed: 0,
    recordsTotal: rows.length,
    message: `Staging ${rows.length} záznamov (${totalBatches} dávok)`,
  });
  for (let i = 0; i < rows.length; i += STAGING_BATCH) {
    const batchNo = Math.floor(i / STAGING_BATCH) + 1;
    const slice = rows.slice(i, i + STAGING_BATCH);
    const { error } = await admin.from("staging_tax_records").insert(slice);
    if (error) {
      logDatahub(`${label} staging batch ${batchNo}/${totalBatches} failed: ${error.message}`);
      await reportProgress(progress, {
        phase: "staging",
        currentBatch: batchNo,
        totalBatches,
        recordsProcessed: staged,
        recordsTotal: rows.length,
        message: `Staging dávka ${batchNo}/${totalBatches} zlyhala: ${error.message}`,
      });
      return { staged, errorMessage: error.message };
    }
    staged += slice.length;
    logDatahub(`${label} staging batch ${batchNo}/${totalBatches} rows=${slice.length} staged=${staged}`);
    await reportProgress(progress, {
      phase: "staging",
      currentBatch: batchNo,
      totalBatches,
      recordsProcessed: staged,
      recordsTotal: rows.length,
      message: `Staging dávka ${batchNo}/${totalBatches}`,
    });
  }
  return { staged, errorMessage: null };
}

export interface ReconcileCounts {
  inserted: number;
  updated: number;
  unchanged: number;
  deactivated: number;
}

// Batch sizes chosen well under Postgres statement_timeout (typically 8s on
// the Data API). Each batch is its own statement — a mid-run failure leaves
// production consistent because we never DELETE from company_* tables, only
// flip is_current/valid_to/removed_at.
const RECONCILE_BATCH = 1000;
const DEACTIVATE_BATCH = 5000;
const MAX_BATCHES = 10_000; // hard safety cap

function logProgress(label: string, batch: number, extra: Record<string, number>): void {
  const parts = Object.entries(extra)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  logDatahub(`${label} reconcile batch ${batch} ${parts}`);
}

function insuranceLabel(provider: InsuranceProviderId): string {
  return provider === "social_insurance" ? "SP" : provider;
}

function taxLabel(dataset: TaxDatasetId): string {
  return dataset === "vat_registered"
    ? "VAT"
    : dataset === "tax_debtors"
      ? "tax_debtors"
      : dataset;
}

export async function reconcileInsurance(
  admin: SupabaseClient,
  provider: InsuranceProviderId,
  runId: string,
  sourceDate: string,
  progress?: ProgressCtx | null,
): Promise<{ counts: ReconcileCounts | null; errorMessage: string | null }> {
  const counts: ReconcileCounts = { inserted: 0, updated: 0, unchanged: 0, deactivated: 0 };
  const label = insuranceLabel(provider);
  logDatahub(`${label} reconciliation start run=${runId} sourceDate=${sourceDate} batchSize=${RECONCILE_BATCH}`);
  await reportProgress(progress, {
    phase: "reconciliation",
    currentBatch: 0,
    totalBatches: null,
    recordsProcessed: 0,
    message: "Rekonciliácia: apply fáza",
  });

  // Phase 1: apply staged rows (insert new / touch unchanged / close+reinsert changed).
  let afterIco: string | null = null;
  let applyProcessed = 0;
  for (let batch = 1; batch <= MAX_BATCHES; batch++) {
    const { data, error } = await admin.rpc("reconcile_insurance_debts_batch", {
      _provider: provider,
      _run_id: runId,
      _source_date: sourceDate,
      _after_ico: afterIco,
      _limit: RECONCILE_BATCH,
    });
    if (error) return { counts: null, errorMessage: `apply batch ${batch}: ${error.message}` };
    const row = Array.isArray(data) ? data[0] : data;
    const processed = Number(row?.processed ?? 0);
    if (!row || processed === 0 || !row.last_ico) {
      logProgress(`${label} apply`, batch, { processed: 0, done: 1 });
      break;
    }
    counts.inserted += Number(row.inserted ?? 0);
    counts.updated += Number(row.updated ?? 0);
    counts.unchanged += Number(row.unchanged ?? 0);
    applyProcessed += processed;
    logProgress(`${label} apply`, batch, {
      processed,
      inserted: Number(row.inserted ?? 0),
      updated: Number(row.updated ?? 0),
      unchanged: Number(row.unchanged ?? 0),
    });
    await reportProgress(progress, {
      phase: "reconciliation",
      currentBatch: batch,
      totalBatches: null,
      recordsProcessed: applyProcessed,
      message: `Rekonciliácia (apply): dávka ${batch}`,
    });
    afterIco = row.last_ico as string;
  }

  // Phase 2: deactivate current rows that no longer appear in staging.
  afterIco = null;
  let deactivateScanned = 0;
  for (let batch = 1; batch <= MAX_BATCHES; batch++) {
    const { data, error } = await admin.rpc("reconcile_insurance_deactivate_batch", {
      _provider: provider,
      _run_id: runId,
      _after_ico: afterIco,
      _limit: DEACTIVATE_BATCH,
    });
    if (error) return { counts: null, errorMessage: `deactivate batch ${batch}: ${error.message}` };
    const row = Array.isArray(data) ? data[0] : data;
    const scanned = Number(row?.scanned ?? 0);
    if (!row || scanned === 0 || !row.last_ico) {
      logProgress(`${label} deactivate`, batch, { scanned: 0, done: 1 });
      break;
    }
    counts.deactivated += Number(row.deactivated ?? 0);
    deactivateScanned += scanned;
    logProgress(`${label} deactivate`, batch, {
      scanned,
      deactivated: Number(row.deactivated ?? 0),
    });
    await reportProgress(progress, {
      phase: "reconciliation",
      currentBatch: batch,
      totalBatches: null,
      recordsProcessed: deactivateScanned,
      message: `Rekonciliácia (deactivate): dávka ${batch}`,
    });
    afterIco = row.last_ico as string;
  }

  // Phase 3: clear staging (small, single statement).
  await admin.rpc("reconcile_insurance_cleanup", { _run_id: runId });
  logDatahub(`${label} reconciliation finished inserted=${counts.inserted} updated=${counts.updated} unchanged=${counts.unchanged} deactivated=${counts.deactivated}`);

  return { counts, errorMessage: null };
}

export async function reconcileTax(
  admin: SupabaseClient,
  dataset: TaxDatasetId,
  runId: string,
  sourceDate: string,
  progress?: ProgressCtx | null,
): Promise<{ counts: ReconcileCounts | null; errorMessage: string | null }> {
  const counts: ReconcileCounts = { inserted: 0, updated: 0, unchanged: 0, deactivated: 0 };
  const label = taxLabel(dataset);
  logDatahub(`${label} reconciliation start run=${runId} sourceDate=${sourceDate} batchSize=${RECONCILE_BATCH}`);
  await reportProgress(progress, {
    phase: "reconciliation",
    currentBatch: 0,
    totalBatches: null,
    recordsProcessed: 0,
    message: "Rekonciliácia: apply fáza",
  });

  let afterIco: string | null = null;
  let applyProcessed = 0;
  for (let batch = 1; batch <= MAX_BATCHES; batch++) {
    const { data, error } = await admin.rpc("reconcile_tax_dataset_batch", {
      _dataset: dataset,
      _run_id: runId,
      _source_date: sourceDate,
      _after_ico: afterIco,
      _limit: RECONCILE_BATCH,
    });
    if (error) return { counts: null, errorMessage: `apply batch ${batch}: ${error.message}` };
    const row = Array.isArray(data) ? data[0] : data;
    const processed = Number(row?.processed ?? 0);
    if (!row || processed === 0 || !row.last_ico) {
      logProgress(`${label} apply`, batch, { processed: 0, done: 1 });
      break;
    }
    counts.inserted += Number(row.inserted ?? 0);
    counts.updated += Number(row.updated ?? 0);
    counts.unchanged += Number(row.unchanged ?? 0);
    applyProcessed += processed;
    logProgress(`${label} apply`, batch, {
      processed,
      inserted: Number(row.inserted ?? 0),
      updated: Number(row.updated ?? 0),
      unchanged: Number(row.unchanged ?? 0),
    });
    await reportProgress(progress, {
      phase: "reconciliation",
      currentBatch: batch,
      totalBatches: null,
      recordsProcessed: applyProcessed,
      message: `Rekonciliácia (apply): dávka ${batch}`,
    });
    afterIco = row.last_ico as string;
  }

  afterIco = null;
  let deactivateScanned = 0;
  for (let batch = 1; batch <= MAX_BATCHES; batch++) {
    const { data, error } = await admin.rpc("reconcile_tax_dataset_deactivate_batch", {
      _dataset: dataset,
      _run_id: runId,
      _after_ico: afterIco,
      _limit: DEACTIVATE_BATCH,
    });
    if (error) return { counts: null, errorMessage: `deactivate batch ${batch}: ${error.message}` };
    const row = Array.isArray(data) ? data[0] : data;
    const scanned = Number(row?.scanned ?? 0);
    if (!row || scanned === 0 || !row.last_ico) {
      logProgress(`${label} deactivate`, batch, { scanned: 0, done: 1 });
      break;
    }
    counts.deactivated += Number(row.deactivated ?? 0);
    deactivateScanned += scanned;
    logProgress(`${label} deactivate`, batch, {
      scanned,
      deactivated: Number(row.deactivated ?? 0),
    });
    await reportProgress(progress, {
      phase: "reconciliation",
      currentBatch: batch,
      totalBatches: null,
      recordsProcessed: deactivateScanned,
      message: `Rekonciliácia (deactivate): dávka ${batch}`,
    });
    afterIco = row.last_ico as string;
  }

  await admin.rpc("reconcile_tax_dataset_cleanup", { _run_id: runId });
  logDatahub(`${label} reconciliation finished inserted=${counts.inserted} updated=${counts.updated} unchanged=${counts.unchanged} deactivated=${counts.deactivated}`);

  return { counts, errorMessage: null };
}

export { shortHash };

/** Best-effort cleanup — orphaned staging rows if a run crashed mid-flight. */
export async function cleanupStaging(
  admin: SupabaseClient,
  table: "staging_insurance_debts" | "staging_tax_records",
  runId: string,
): Promise<void> {
  await admin.from(table).delete().eq("run_id", runId);
}
