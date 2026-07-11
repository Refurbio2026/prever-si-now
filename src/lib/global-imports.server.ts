// Orchestrator for the daily global DataHub imports.
// Runs Social Insurance → Tax debtors (download+validation+staging only,
// reconciliation stays disabled per provider spec) → VAT register.
// Each importer is wrapped in its own try/catch. If one fails, the next still
// runs. A row in datahub_settings acts as a lock to prevent duplicate runs and
// is released from a finally block no matter how the chain ends.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type StepId = "social_insurance" | "tax_debtors" | "vat_registered" | "rpo_register";

export interface GlobalStepResult {
  step: string;
  ok: boolean;
  status: string | null;
  errorMessage: string | null;
  recordsInserted?: number;
  recordsUpdated?: number;
  recordsUnchanged?: number;
  recordsDeactivated?: number;
}

export interface GlobalImportResult {
  ok: boolean;
  skipped?: "already_running";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: GlobalStepResult[];
}

const LOCK_STALE_MS = 30 * 60 * 1000; // 30 minutes

function admin(): SupabaseClient {
  // Loaded on demand to avoid pulling client.server into route module scope.
  throw new Error("admin() must be reassigned before use");
}

async function loadAdmin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

async function tryAcquireLock(
  sb: SupabaseClient,
  runId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("datahub_settings")
    .select("global_import_running, global_import_started_at")
    .eq("id", true)
    .maybeSingle<{
      global_import_running: boolean | null;
      global_import_started_at: string | null;
    }>();

  const running = data?.global_import_running ?? false;
  const startedAt = data?.global_import_started_at
    ? new Date(data.global_import_started_at).getTime()
    : 0;
  const stale = running && Date.now() - startedAt > LOCK_STALE_MS;

  if (running && !stale) return false;

  const { error } = await sb
    .from("datahub_settings")
    .upsert(
      {
        id: true,
        global_import_running: true,
        global_import_started_at: new Date().toISOString(),
        global_import_current_run_id: runId,
      },
      { onConflict: "id" },
    );
  return !error;
}

async function releaseLock(sb: SupabaseClient): Promise<void> {
  await sb
    .from("datahub_settings")
    .update({
      global_import_running: false,
      global_import_last_finished_at: new Date().toISOString(),
    })
    .eq("id", true);
}

function stepSource(step: StepId): string {
  if (step === "social_insurance") return "social_insurance";
  if (step === "rpo_register") return "rpo_register";
  return `fs_${step}`;
}

async function writeFailureFreshness(
  sb: SupabaseClient,
  step: StepId,
  message: string,
): Promise<void> {
  const now = new Date().toISOString();
  await sb.from("data_freshness").upsert(
    {
      ico: "__GLOBAL__",
      source: stepSource(step),
      last_attempt_at: now,
      status: "failed",
      error_message: message,
      updated_at: now,
    },
    { onConflict: "ico,source" },
  );
}

function logStep(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[global-imports] ${message}`);
}

function logStepError(message: string, err?: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    `[global-imports] ${message}`,
    err instanceof Error ? (err.stack ?? err.message) : (err ?? ""),
  );
}

async function runStep(
  step: StepId,
  sb: SupabaseClient,
  runId: string,
): Promise<GlobalStepResult> {
  const started = Date.now();
  try {
    logStep(`step=${step} start`);
    if (step === "social_insurance") {
      const { importOneProvider } = await import("@/lib/insurance-debt.server");
      const r = await importOneProvider("social_insurance", runId);
      return {
        step,
        ok: r.status === "success" || r.status === "unchanged" || r.status === "empty",
        status: r.status ?? null,
        errorMessage: r.errorMessage ?? null,
        recordsInserted: r.recordsInserted,
        recordsUpdated: r.recordsUpdated,
        recordsUnchanged: r.recordsUnchanged,
        recordsDeactivated: r.recordsDeactivated,
      };
    }

    if (step === "rpo_register") {
      const { importRpoRegister } = await import("@/lib/rpo-register.server");
      const r = await importRpoRegister(runId);
      return {
        step,
        ok: r.status === "success" || r.status === "unchanged",
        status: r.status ?? null,
        errorMessage: r.errorMessage ?? null,
        recordsInserted: r.recordsInserted,
        recordsUpdated: r.recordsUpdated,
        recordsUnchanged: r.recordsUnchanged,
        recordsDeactivated: r.recordsDeactivated,
      };
    }

    const { importOneDataset } = await import("@/lib/tax-status.server");
    const dataset = step === "tax_debtors" ? "tax_debtors" : "vat_registered";
    const r = await importOneDataset(dataset, runId);
    return {
      step,
      ok:
        step === "tax_debtors"
          ? r.status !== "failed" && r.status !== "crashed"
          : r.status === "success" || r.status === "unchanged" || r.status === "empty",
      status: r.status ?? null,
      errorMessage: r.errorMessage ?? null,
      recordsInserted: r.recordsInserted,
      recordsUpdated: r.recordsUpdated,
      recordsUnchanged: r.recordsUnchanged,
      recordsDeactivated: r.recordsDeactivated,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Step crashed";
    logStepError(`step=${step} crashed`, err);
    try {
      await writeFailureFreshness(sb, step, message);
    } catch (freshnessErr) {
      logStepError(`step=${step} failed to write data_freshness`, freshnessErr);
    }
    try {
      const { reportProgress } = await import("@/lib/import-progress.server");
      await reportProgress(
        { admin: sb, runId, source: stepSource(step) },
        { phase: "failed", message },
      );
    } catch {
      /* ignored */
    }
    return {
      step,
      ok: false,
      status: "crashed",
      errorMessage: message,
    };
  } finally {
    logStep(`step=${step} finished durationMs=${Date.now() - started}`);
  }
}

export async function runGlobalImports(): Promise<GlobalImportResult> {
  void admin;
  const sb = await loadAdmin();
  const startedAt = new Date();
  const runId = randomUUID();
  logStep(`run start runId=${runId}`);

  if (!(await tryAcquireLock(sb, runId))) {
    const finishedAt = new Date();
    return {
      ok: false,
      skipped: "already_running",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      steps: [],
    };
  }

  const steps: GlobalStepResult[] = [];
  const stepIds = ["social_insurance", "tax_debtors", "vat_registered"] as const;

  try {
    for (const step of stepIds) {
      const stepResult = await runStep(step, sb, runId);
      steps.push(stepResult);
      logStep(`step=${step} ok=${stepResult.ok} status=${stepResult.status ?? "n/a"}`);
    }
  } finally {
    try {
      await releaseLock(sb);
      logStep("lock released");
    } catch (err) {
      logStepError("lock release failed", err);
    }
  }


  const finishedAt = new Date();
  return {
    ok: steps.every((s) => s.ok),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    steps,
  };
}
