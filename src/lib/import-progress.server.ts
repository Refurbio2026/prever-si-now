// Lightweight progress reporter for global DataHub imports.
// Writes a single row per (run_id, source) into datahub_import_progress.
// EVERY call is wrapped in try/catch — a progress write MUST NEVER fail an
// import. The admin UI polls this table to render live progress.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ProgressPhase =
  | "download"
  | "validation"
  | "staging"
  | "reconciliation"
  | "done"
  | "failed";

export interface ProgressCtx {
  admin: SupabaseClient;
  runId: string;
  source: string;
}

export interface ProgressPatch {
  phase: ProgressPhase;
  currentBatch?: number | null;
  totalBatches?: number | null;
  recordsProcessed?: number | null;
  recordsTotal?: number | null;
  message?: string | null;
}

export async function reportProgress(
  ctx: ProgressCtx | null | undefined,
  patch: ProgressPatch,
): Promise<void> {
  if (!ctx) return;
  try {
    await ctx.admin.from("datahub_import_progress").upsert(
      {
        run_id: ctx.runId,
        source: ctx.source,
        phase: patch.phase,
        current_batch: patch.currentBatch ?? null,
        total_batches: patch.totalBatches ?? null,
        records_processed: patch.recordsProcessed ?? null,
        records_total: patch.recordsTotal ?? null,
        message: patch.message ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,source" },
    );
  } catch {
    // Best-effort — never propagate.
  }
}
