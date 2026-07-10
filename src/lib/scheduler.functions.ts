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

// NOTE: the scheduler overview reader is now client-side (see /admin/datahub —
// it calls supabase.rpc("get_scheduler_status") + admin-RLS reads directly).
// Only the manual-trigger server fns remain here, which still need the admin
// client for orchestration side-effects.


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
