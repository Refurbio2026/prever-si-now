// Orchestrator for the daily global DataHub imports.
// Runs Social Insurance → Tax debtors (download+validation+staging only,
// reconciliation stays disabled per provider spec) → VAT register.
// Each importer is wrapped in its own try/catch and logged into
// data_freshness by the underlying orchestrators. If one fails, the next
// still runs. A row in datahub_settings acts as a lock to prevent duplicate
// concurrent runs.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDatahubSecret } from "@/lib/hooks-auth.server";

const LOVABLE_PROJECT_ID = "2a19b096-ded5-4f98-b01e-ebcff1046c4a";
const STEP_TIMEOUT_MS = 55_000;
type StepId = "social_insurance" | "tax_debtors" | "vat_registered";

function baseUrl(): string {
  const explicit = process.env.DATAHUB_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  return `https://project--${LOVABLE_PROJECT_ID}.lovable.app`;
}

async function runStepIsolated(step: StepId): Promise<GlobalStepResult> {
  const url = `${baseUrl()}/api/public/hooks/run-import-step`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);
  try {
    const secret = await loadDatahubSecret();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Datahub-Secret": secret,
      },
      body: JSON.stringify({ step }),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      return {
        step,
        ok: false,
        status: (parsed.status as string | null) ?? `http_${res.status}`,
        errorMessage:
          (parsed.errorMessage as string | null) ??
          `Krok zlyhal (HTTP ${res.status}): ${text.slice(0, 200)}`,
      };
    }
    return {
      step,
      ok: Boolean(parsed.ok),
      status: (parsed.status as string | null) ?? null,
      errorMessage: (parsed.errorMessage as string | null) ?? null,
      recordsInserted: parsed.recordsInserted as number | undefined,
      recordsUpdated: parsed.recordsUpdated as number | undefined,
      recordsUnchanged: parsed.recordsUnchanged as number | undefined,
      recordsDeactivated: parsed.recordsDeactivated as number | undefined,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      step,
      ok: false,
      status: aborted ? "timeout" : "dispatch_failed",
      errorMessage: aborted
        ? `Krok vypršal po ${Math.round(STEP_TIMEOUT_MS / 1000)}s.`
        : err instanceof Error
          ? err.message
          : "Neznáma chyba pri dispatchi.",
    };
  } finally {
    clearTimeout(timer);
  }
}

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
  const stepIds = ["social_insurance", "tax_debtors", "vat_registered"] as const;

  try {
    for (const step of stepIds) {
      // eslint-disable-next-line no-console
      console.log(`[global-imports] dispatching step=${step}`);
      const stepResult = await runStepIsolated(step);
      steps.push(stepResult);
      // eslint-disable-next-line no-console
      console.log(
        `[global-imports] step=${step} ok=${stepResult.ok} status=${stepResult.status ?? "n/a"}`,
      );
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
