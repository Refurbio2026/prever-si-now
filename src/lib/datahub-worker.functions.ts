// Client-safe module — admin server functions for the DataHub worker
// pause switch and recent-run history.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nemáte oprávnenie na túto akciu.");
}

export interface WorkerSettings {
  workerPaused: boolean;
  updatedAt: string | null;
}

export interface WorkerRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  triggerSource: string;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  paused: boolean;
  errorMessage: string | null;
}

export interface WorkerStatus {
  settings: WorkerSettings;
  lastRun: WorkerRun | null;
  recentRuns: WorkerRun[];
  totals: {
    last24h: { runs: number; processed: number; successful: number; failed: number };
  };
}

export const getWorkerStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WorkerStatus> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: settings }, { data: runs }] = await Promise.all([
      supabaseAdmin
        .from("datahub_settings")
        .select("worker_paused, updated_at")
        .eq("id", true)
        .maybeSingle(),
      supabaseAdmin
        .from("datahub_worker_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(20),
    ]);

    const mapped: WorkerRun[] = (runs ?? []).map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      durationMs: r.duration_ms,
      triggerSource: r.trigger_source,
      processed: r.processed ?? 0,
      successful: r.successful ?? 0,
      failed: r.failed ?? 0,
      skipped: r.skipped ?? 0,
      paused: r.paused ?? false,
      errorMessage: r.error_message,
    }));

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const last24 = mapped.filter((r) => new Date(r.startedAt).getTime() >= dayAgo);
    const totals = {
      last24h: {
        runs: last24.length,
        processed: last24.reduce((s, r) => s + r.processed, 0),
        successful: last24.reduce((s, r) => s + r.successful, 0),
        failed: last24.reduce((s, r) => s + r.failed, 0),
      },
    };

    return {
      settings: {
        workerPaused: settings?.worker_paused ?? false,
        updatedAt: settings?.updated_at ?? null,
      },
      lastRun: mapped[0] ?? null,
      recentRuns: mapped,
      totals,
    };
  });

const pauseSchema = z.object({ paused: z.boolean() });

export const setWorkerPausedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => pauseSchema.parse(input))
  .handler(async ({ data, context }): Promise<WorkerSettings> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const { data: row, error } = await supabaseAdmin
      .from("datahub_settings")
      .upsert(
        {
          id: true,
          worker_paused: data.paused,
          updated_at: now,
          updated_by: context.userId,
        },
        { onConflict: "id" },
      )
      .select("worker_paused, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      workerPaused: row.worker_paused,
      updatedAt: row.updated_at,
    };
  });
