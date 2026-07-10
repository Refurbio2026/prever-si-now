// Admin-only server functions for the DataHub scheduler overview.
// Show recent runs of the daily orchestrator + the per-minute worker,
// plus manual "Run now" triggers that reuse the same code paths as pg_cron.

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nemáte oprávnenie na túto akciu.");
}

export interface SchedulerJobStatus {
  name: string;
  schedule: string;
  description: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  running: boolean;
  cronSchedule: string | null;
  cronActive: boolean | null;
  cronLastStart: string | null;
  cronLastEnd: string | null;
  cronLastStatus: string | null;
}

export interface SchedulerOverview {
  jobs: SchedulerJobStatus[];
  cronError: string | null;
}

export const getSchedulerOverviewFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SchedulerOverview> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Global orchestrator: read latest finished insurance/tax run + lock flag.
    const { data: settings } = await supabaseAdmin
      .from("datahub_settings")
      .select(
        "global_import_running, global_import_started_at, global_import_last_finished_at",
      )
      .eq("id", true)
      .maybeSingle<{
        global_import_running: boolean | null;
        global_import_started_at: string | null;
        global_import_last_finished_at: string | null;
      }>();

    // Latest insurance/tax freshness rows for a compact "last status" summary.
    const { data: freshRows } = await supabaseAdmin
      .from("data_freshness")
      .select("source, last_attempt_at, status, error_message")
      .eq("ico", "__GLOBAL__")
      .order("last_attempt_at", { ascending: false })
      .limit(20);

    const anyFail = (freshRows ?? []).find(
      (r) => r.status && r.status !== "success",
    );
    const lastAttempt = (freshRows ?? [])[0]?.last_attempt_at ?? null;

    // Worker: last run row.
    const { data: workerRuns } = await supabaseAdmin
      .from("datahub_worker_runs")
      .select("started_at, finished_at, processed, failed, error_message")
      .order("started_at", { ascending: false })
      .limit(1);
    const lastWorker = workerRuns?.[0];

    return {
      jobs: [
        {
          name: "datahub-global-imports",
          schedule: "denne o 04:00 Europe/Bratislava",
          description:
            "Sociálna poisťovňa → Zoznam daňových dlžníkov (stiahnutie + validácia + staging) → Register platiteľov DPH.",
          lastRunAt:
            settings?.global_import_last_finished_at ??
            settings?.global_import_started_at ??
            lastAttempt,
          lastStatus: anyFail
            ? `chyba: ${anyFail.source}`
            : lastAttempt
              ? "success"
              : null,
          lastError: anyFail?.error_message ?? null,
          running: settings?.global_import_running ?? false,
        },
        {
          name: "datahub-queue-worker",
          schedule: "každú minútu",
          description:
            "Spracuje čakajúce IČO úlohy z fronty datahub. Rešpektuje pauzu.",
          lastRunAt: lastWorker?.started_at ?? null,
          lastStatus: lastWorker
            ? lastWorker.error_message
              ? "failed"
              : "success"
            : null,
          lastError: lastWorker?.error_message ?? null,
          running: lastWorker ? lastWorker.finished_at === null : false,
        },
      ],
    };
  });

export const runGlobalImportsNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { runGlobalImports } = await import("@/lib/global-imports.server");
    return runGlobalImports();
  });

export const runQueueWorkerNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { processQueueBatch } = await import("@/lib/datahub.server");
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const startedAt = new Date();
    try {
      const res = await processQueueBatch(10);
      const finishedAt = new Date();
      await supabaseAdmin.from("datahub_worker_runs").insert({
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        trigger_source: "manual",
        processed: res.processed,
        successful: res.successful,
        failed: res.failed,
        skipped: res.skipped,
        paused: false,
      });
      return { ok: true, ...res };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Worker crashed";
      const finishedAt = new Date();
      await supabaseAdmin.from("datahub_worker_runs").insert({
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        trigger_source: "manual",
        processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        paused: false,
        error_message: msg,
      });
      throw err;
    }
  });
