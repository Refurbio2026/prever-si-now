// Server-only orchestrator for insurance-debt imports.
// Full flow per provider:
//   1. Create insurance_import_runs row (status='running') — get run_id.
//   2. Run importer.
//   3. If not_implemented / failed / unchanged (hash match) → mark run, return.
//   4. Validate the outcome (min records, valid IČO ratio, duplicate ratio).
//   5. Snapshot the previous current state (per-provider) for change detection.
//   6. Insert normalized rows into staging_insurance_debts.
//   7. Call reconcile_insurance_debts RPC (Postgres — advisory lock + txn).
//   8. Emit monitoring changes for watched companies only.
//   9. Update run row with final counters and status.
// Never throws — one failing provider must not break the others.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  INSURANCE_PROVIDERS,
  type ImporterOutcome,
  type InsuranceProviderId,
} from "@/lib/insurance-debt.types";
import { importSocialInsuranceDebtors } from "@/lib/providers/social-insurance-debt.provider.server";
import { importVszpDebtors } from "@/lib/providers/vszp-debt.provider.server";
import { importDoveraDebtors } from "@/lib/providers/dovera-debt.provider.server";
import { importUnionDebtors } from "@/lib/providers/union-debt.provider.server";
import {
  cleanupStaging,
  reconcileInsurance,
  shortHash,
  stageInsurance,
  validateInsurance,
} from "@/lib/reconcile.server";
import {
  reportProgress,
  type ProgressCtx,
} from "@/lib/import-progress.server";

function admin(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

function providerLogLabel(provider: InsuranceProviderId): string {
  return provider === "social_insurance" ? "SP" : provider;
}

function logImport(provider: InsuranceProviderId, message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[datahub] ${providerLogLabel(provider)} ${message}`);
}

function logImportError(provider: InsuranceProviderId, message: string, err?: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    `[datahub] ${providerLogLabel(provider)} ${message}`,
    err instanceof Error ? (err.stack ?? err.message) : (err ?? ""),
  );
}

async function writeFreshness(
  provider: InsuranceProviderId,
  ok: boolean,
  message: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await admin()
    .from("data_freshness")
    .upsert(
      {
        ico: "__GLOBAL__",
        source: provider,
        last_attempt_at: now,
        last_success_at: ok ? now : undefined,
        status: ok ? "success" : "failed",
        error_message: message,
        updated_at: now,
      },
      { onConflict: "ico,source" },
    );
}

async function latestSuccessHash(
  provider: InsuranceProviderId,
): Promise<string | null> {
  const { data } = await admin()
    .from("insurance_import_runs")
    .select("content_hash")
    .eq("provider", provider)
    .in("status", ["success", "empty", "unchanged"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { content_hash: string | null } | null)?.content_hash ?? null;
}

async function insertRunRow(
  provider: InsuranceProviderId,
  startedAt: Date,
): Promise<string | null> {
  const { data, error } = await admin()
    .from("insurance_import_runs")
    .insert({
      provider,
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
  records_with_ico?: number;
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
  await admin().from("insurance_import_runs").update(patch).eq("id", runId);
}

interface WatchedSnapshot {
  amount: number | null;
  hash: string | null;
}

async function snapshotCurrentForWatched(
  provider: InsuranceProviderId,
): Promise<Map<string, WatchedSnapshot>> {
  const { data: watched } = await admin().from("watched_companies").select("ico");
  const icos = ((watched as Array<{ ico: string }> | null) ?? []).map((w) => w.ico);
  const out = new Map<string, WatchedSnapshot>();
  if (icos.length === 0) return out;
  const { data } = await admin()
    .from("company_insurance_debts")
    .select("ico, debt_amount, source_record_hash")
    .eq("provider", provider)
    .eq("is_current", true)
    .in("ico", icos);
  for (const row of (data as Array<{
    ico: string;
    debt_amount: number | null;
    source_record_hash: string | null;
  }> | null) ?? []) {
    out.set(row.ico, { amount: row.debt_amount, hash: row.source_record_hash });
  }
  return out;
}

async function emitChanges(
  provider: InsuranceProviderId,
  prev: Map<string, WatchedSnapshot>,
): Promise<void> {
  if (prev.size === 0) {
    // Nothing to compare against for watched companies — but we still want to
    // flag "newly added debts" for watched companies that had no prior record.
  }
  const { data: watched } = await admin().from("watched_companies").select("ico");
  const watchedIcos = ((watched as Array<{ ico: string }> | null) ?? []).map((w) => w.ico);
  if (watchedIcos.length === 0) return;

  const { data: nowCurrent } = await admin()
    .from("company_insurance_debts")
    .select("ico, debt_amount, source_record_hash")
    .eq("provider", provider)
    .eq("is_current", true)
    .in("ico", watchedIcos);

  const curMap = new Map<string, WatchedSnapshot>();
  for (const row of (nowCurrent as Array<{
    ico: string;
    debt_amount: number | null;
    source_record_hash: string | null;
  }> | null) ?? []) {
    curMap.set(row.ico, { amount: row.debt_amount, hash: row.source_record_hash });
  }

  const changes: Array<{
    ico: string;
    change_type: string;
    title: string;
    description: string;
    severity: string;
  }> = [];

  for (const [ico, cur] of curMap) {
    const before = prev.get(ico);
    if (!before) {
      changes.push({
        ico,
        change_type: "insurance_debt_added",
        title: `Nový dlh voči poisťovni (${provider})`,
        description:
          cur.amount != null
            ? `Firma bola pridaná do zverejneného zoznamu dlžníkov, dlh: ${cur.amount.toFixed(2)} €.`
            : "Firma bola pridaná do zverejneného zoznamu dlžníkov.",
        severity: cur.amount != null && cur.amount >= 1000 ? "critical" : "warning",
      });
    } else if (before.hash !== cur.hash) {
      changes.push({
        ico,
        change_type: "insurance_debt_amount_changed",
        title: `Zmena výšky dlhu (${provider})`,
        description: `Predtým ${before.amount ?? "n/a"} €, aktuálne ${cur.amount ?? "n/a"} €.`,
        severity: "warning",
      });
    }
  }
  for (const [ico] of prev) {
    if (!curMap.has(ico)) {
      changes.push({
        ico,
        change_type: "insurance_debt_removed_from_published_list",
        title: `Firma odstránená zo zoznamu dlžníkov (${provider})`,
        description:
          "Firma už nie je uvedená v aktuálnom zverejnenom zozname dlžníkov.",
        severity: "info",
      });
    }
  }

  if (changes.length > 0) {
    await admin().from("company_changes").insert(changes);
  }
}

function runImporterFor(provider: InsuranceProviderId): Promise<ImporterOutcome> {
  switch (provider) {
    case "social_insurance":
      return importSocialInsuranceDebtors();
    case "vszp":
      return importVszpDebtors();
    case "dovera":
      return importDoveraDebtors();
    case "union":
      return importUnionDebtors();
  }
}

export interface ProviderImportResult {
  provider: InsuranceProviderId;
  status?: string;
  recordsInserted: number;
  recordsUpdated: number;
  recordsUnchanged: number;
  recordsDeactivated: number;
  errorMessage: string | null;
}

export async function importOneProvider(
  provider: InsuranceProviderId,
  globalRunId?: string,
): Promise<ProviderImportResult> {
  const progress: ProgressCtx | null = globalRunId
    ? { admin: admin(), runId: globalRunId, source: provider }
    : null;

  const startedAt = new Date();
  const runId = await insertRunRow(provider, startedAt);
  if (!runId) {
    const msg = "Nepodarilo sa vytvoriť záznam behu.";
    logImportError(provider, msg);
    await writeFreshness(provider, false, msg);
    return {
      provider,
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: msg,
    };
  }

  let outcome: ImporterOutcome;
  try {
    logImport(provider, `start run=${runId}`);
    await reportProgress(progress, {
      phase: "download",
      message: "Sťahovanie zdroja",
    });
    outcome = await runImporterFor(provider);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznáma chyba importu.";
    logImportError(provider, "importer crashed", err);
    await updateRunRow(runId, {
      status: "failed",
      error_message: msg,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(provider, false, msg);
    await reportProgress(progress, { phase: "failed", message: msg });
    return {
      provider,
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
    records_with_ico: outcome.recordsWithIco,
  };
  logImport(
    provider,
    `downloaded records=${outcome.recordsDownloaded} hash=${shortHash(outcome.contentHash)} status=${outcome.status}`,
  );

  // Early-exit statuses.
  if (outcome.status === "not_implemented" || outcome.status === "failed") {
    logImportError(provider, `failed before validation: ${outcome.errorMessage ?? "unknown"}`);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: outcome.status,
      error_message: outcome.errorMessage,
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(provider, false, outcome.errorMessage);
    await reportProgress(progress, {
      phase: "failed",
      message: outcome.errorMessage ?? outcome.status,
    });
    return {
      provider,
      status: outcome.status,
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: outcome.errorMessage,
    };
  }

  // Hash-based skip. NEVER reconcile when source is unchanged.
  const prevHash = await latestSuccessHash(provider);
  if (outcome.contentHash && prevHash && outcome.contentHash === prevHash) {
    logImport(provider, `validation skipped unchanged hash=${shortHash(outcome.contentHash)}`);
    await updateRunRow(runId, {
      ...commonUpdate,
      status: "unchanged",
      previous_source_hash: prevHash,
      validation_status: "skipped",
      finished_at: new Date().toISOString(),
    });
    await writeFreshness(provider, true, "Dataset nezmenený od posledného behu.");
    await reportProgress(progress, {
      phase: "done",
      message: "Dataset nezmenený od posledného behu.",
    });
    return {
      provider,
      status: "unchanged",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: null,
    };
  }

  // Validation gate. On failure — NEVER deactivate existing records.
  await reportProgress(progress, { phase: "validation", message: "Validácia dát" });
  const validation = validateInsurance(outcome.records, provider);
  logImport(
    provider,
    `validation ok=${validation.ok} valid=${validation.validCount} invalid=${validation.invalidCount} duplicateRatio=${validation.duplicateRatio.toFixed(4)}`,
  );
  if (!validation.ok) {
    logImportError(provider, `validation failed: ${validation.reason ?? "unknown"}`);
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
    await writeFreshness(provider, false, validation.reason);
    await reportProgress(progress, {
      phase: "failed",
      message: validation.reason ?? "Validácia zlyhala",
    });
    return {
      provider,
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: validation.reason,
    };
  }

  // Snapshot BEFORE reconciliation for change detection.
  const prevSnapshot = await snapshotCurrentForWatched(provider);

  // Stage.
  const staged = await stageInsurance(
    admin(),
    outcome.records,
    runId,
    providerLogLabel(provider),
    progress,
  );
  if (staged.errorMessage) {
    logImportError(provider, `staging failed after ${staged.staged} rows: ${staged.errorMessage}`);
    await cleanupStaging(admin(), "staging_insurance_debts", runId);
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
    await writeFreshness(provider, false, staged.errorMessage);
    await reportProgress(progress, {
      phase: "failed",
      message: `Staging chyba: ${staged.errorMessage}`,
    });
    return {
      provider,
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: staged.errorMessage,
    };
  }

  // Reconcile atomically inside Postgres.
  const sourceDate = outcome.sourceRecordDate ?? new Date().toISOString().slice(0, 10);
  const rec = await reconcileInsurance(admin(), provider, runId, sourceDate, progress);
  if (rec.errorMessage || !rec.counts) {
    logImportError(provider, `reconciliation failed: ${rec.errorMessage ?? "unknown"}`);
    await cleanupStaging(admin(), "staging_insurance_debts", runId);
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
    await writeFreshness(provider, false, rec.errorMessage);
    await reportProgress(progress, {
      phase: "failed",
      message: `Reconciliation zlyhal: ${rec.errorMessage ?? "unknown"}`,
    });
    return {
      provider,
      status: "failed",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      errorMessage: rec.errorMessage,
    };
  }

  // Emit monitoring changes (watched only). Best-effort — never fails the run.
  try {
    await emitChanges(provider, prevSnapshot);
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
  await writeFreshness(provider, true, null);
  logImport(
    provider,
    `final status=success inserted=${rec.counts.inserted} updated=${rec.counts.updated} unchanged=${rec.counts.unchanged} deactivated=${rec.counts.deactivated}`,
  );
  await reportProgress(progress, {
    phase: "done",
    message: `Hotovo: +${rec.counts.inserted} / ~${rec.counts.updated} / =${rec.counts.unchanged} / −${rec.counts.deactivated}`,
    recordsProcessed:
      rec.counts.inserted + rec.counts.updated + rec.counts.unchanged,
  });

  return {
    provider,
    status: "success",
    recordsInserted: rec.counts.inserted,
    recordsUpdated: rec.counts.updated,
    recordsUnchanged: rec.counts.unchanged,
    recordsDeactivated: rec.counts.deactivated,
    errorMessage: null,
  };
}

export async function importAllInsuranceDebtors(): Promise<ProviderImportResult[]> {
  const results: ProviderImportResult[] = [];
  for (const p of INSURANCE_PROVIDERS) {
    try {
      results.push(await importOneProvider(p));
    } catch (err) {
      logImportError(p, "provider wrapper crashed", err);
      await writeFreshness(
        p,
        false,
        err instanceof Error ? err.message : "Neznáma chyba.",
      );
      results.push({
        provider: p,
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
