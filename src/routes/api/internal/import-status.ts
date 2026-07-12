// Lightweight status endpoint for deploy/import collision guard.
// Returns whether a global import is currently running, so a deploy hook
// can defer the restart until the run finishes. No auth: the response
// exposes only non-sensitive fields (running flag, source, started_at,
// current run id).
//
// A lock is treated as stale after 3 hours (matches LOCK_STALE_MS in
// global-imports.server.ts) and reported as `running=false, stale=true`.

import { createFileRoute } from "@tanstack/react-router";

const LOCK_STALE_MS = 3 * 60 * 60 * 1000;

async function run(): Promise<Response> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("datahub_settings")
      .select(
        "global_import_running, global_import_started_at, global_import_current_run_id",
      )
      .eq("id", true)
      .maybeSingle<{
        global_import_running: boolean | null;
        global_import_started_at: string | null;
        global_import_current_run_id: string | null;
      }>();
    if (error) {
      return Response.json(
        { running: false, error: "settings_read_failed" },
        { status: 500 },
      );
    }
    const startedAt = data?.global_import_started_at ?? null;
    const startedMs = startedAt ? new Date(startedAt).getTime() : 0;
    const stale = !!startedMs && Date.now() - startedMs > LOCK_STALE_MS;
    const running = !!data?.global_import_running && !stale;
    return Response.json(
      {
        running,
        stale: !!data?.global_import_running && stale,
        started_at: startedAt,
        current_run_id: data?.global_import_current_run_id ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ running: false, error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/internal/import-status")({
  server: {
    handlers: {
      GET: () => run(),
    },
  },
});
