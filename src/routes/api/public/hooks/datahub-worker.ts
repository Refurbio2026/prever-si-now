// Public HTTP endpoint for the DataHub background worker.
// Anonymous — safe to call from pg_cron or an external scheduler. Never
// exposes company or user data; only returns aggregate counters.
// Respects the admin pause switch in datahub_settings and logs every run
// into datahub_worker_runs for the admin dashboard.

import { createFileRoute } from "@tanstack/react-router";

async function runWorker(limit: number, trigger: string) {
  const { processQueueBatch } = await import("@/lib/datahub.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const startedAt = new Date();

  // Check pause switch first — never process jobs while paused.
  const { data: settings } = await supabaseAdmin
    .from("datahub_settings")
    .select("worker_paused")
    .eq("id", true)
    .maybeSingle();
  const paused = settings?.worker_paused ?? false;

  if (paused) {
    await supabaseAdmin.from("datahub_worker_runs").insert({
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: 0,
      trigger_source: trigger,
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      paused: true,
    });
    return Response.json({ ok: true, paused: true, processed: 0 });
  }

  try {
    const res = await processQueueBatch(limit);
    const finishedAt = new Date();
    await supabaseAdmin.from("datahub_worker_runs").insert({
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      trigger_source: trigger,
      processed: res.processed,
      successful: res.successful,
      failed: res.failed,
      skipped: res.skipped,
      paused: false,
    });
    return Response.json({ ok: true, paused: false, ...res });
  } catch (err) {
    const msg = (err as Error).message ?? "Worker crashed";
    const finishedAt = new Date();
    await supabaseAdmin.from("datahub_worker_runs").insert({
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      trigger_source: trigger,
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      paused: false,
      error_message: msg,
    });
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

function parseLimit(value: unknown): number {
  const raw = Number(value ?? 25);
  return Number.isFinite(raw) ? Math.min(Math.max(1, raw), 25) : 25;
}

export const Route = createFileRoute("/api/public/hooks/datahub-worker")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const trigger = url.searchParams.get("trigger") ?? "cron";
        return runWorker(parseLimit(url.searchParams.get("limit")), trigger);
      },
      POST: async ({ request }) => {
        const url = new URL(request.url);
        let body: { limit?: number; trigger?: string } = {};
        try {
          body = (await request.json()) as { limit?: number; trigger?: string };
        } catch {
          body = {};
        }
        const trigger = url.searchParams.get("trigger") ?? body.trigger ?? "cron";
        return runWorker(
          parseLimit(url.searchParams.get("limit") ?? body.limit),
          trigger,
        );
      },
    },
  },
});
