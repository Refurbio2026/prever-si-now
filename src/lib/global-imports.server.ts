// Orchestrator for the daily global DataHub imports.
// Runs Social Insurance → Tax debtors (download+validation+staging only,
// reconciliation stays disabled per provider spec) → VAT register.
// Each importer is wrapped in its own try/catch and logged into
// data_freshness by the underlying orchestrators. If one fails, the next
// still runs. A row in datahub_settings acts as a lock to prevent duplicate
// concurrent runs.

import type { SupabaseClient } from "@supabase/supabase-js";

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

async function tryAcquireLock(sb: SupabaseClient): Promise<boolean> {
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

export async function runGlobalImports(): Promise<GlobalImportResult> {
  void admin;
  const sb = await loadAdmin();
  const startedAt = new Date();

  if (!(await tryAcquireLock(sb))) {
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

  try {
    // 1. Social Insurance
    try {
      const { importOneProvider } = await import("@/lib/insurance-debt.server");
      const r = await importOneProvider("social_insurance");
      steps.push({
        step: "social_insurance",
        ok: r.status === "success" || r.status === "unchanged" || r.status === "empty",
        status: r.status ?? null,
        errorMessage: r.errorMessage ?? null,
        recordsInserted: r.recordsInserted,
        recordsUpdated: r.recordsUpdated,
        recordsUnchanged: r.recordsUnchanged,
        recordsDeactivated: r.recordsDeactivated,
      });
    } catch (err) {
      steps.push({
        step: "social_insurance",
        ok: false,
        status: "crashed",
        errorMessage: err instanceof Error ? err.message : "Neznáma chyba",
      });
    }

    // 2. Tax debtors (download + validation + staging; reconciliation disabled)
    try {
      const { importOneDataset } = await import("@/lib/tax-status.server");
      const r = await importOneDataset("tax_debtors");
      steps.push({
        step: "tax_debtors",
        ok: r.status !== "failed" && r.status !== "crashed",
        status: r.status ?? null,
        errorMessage: r.errorMessage ?? null,
        recordsInserted: r.recordsInserted,
        recordsUpdated: r.recordsUpdated,
        recordsUnchanged: r.recordsUnchanged,
        recordsDeactivated: r.recordsDeactivated,
      });
    } catch (err) {
      steps.push({
        step: "tax_debtors",
        ok: false,
        status: "crashed",
        errorMessage: err instanceof Error ? err.message : "Neznáma chyba",
      });
    }

    // 3. VAT register
    try {
      const { importOneDataset } = await import("@/lib/tax-status.server");
      const r = await importOneDataset("vat_registered");
      steps.push({
        step: "vat_registered",
        ok: r.status === "success" || r.status === "unchanged" || r.status === "empty",
        status: r.status ?? null,
        errorMessage: r.errorMessage ?? null,
        recordsInserted: r.recordsInserted,
        recordsUpdated: r.recordsUpdated,
        recordsUnchanged: r.recordsUnchanged,
        recordsDeactivated: r.recordsDeactivated,
      });
    } catch (err) {
      steps.push({
        step: "vat_registered",
        ok: false,
        status: "crashed",
        errorMessage: err instanceof Error ? err.message : "Neznáma chyba",
      });
    }
  } finally {
    await releaseLock(sb);
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
