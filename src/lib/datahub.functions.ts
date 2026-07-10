// Client-safe module — server-fn declarations only for the DataHub admin page.
// All privileged operations run inside handlers and are gated by an admin check.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SOURCE_ENUM = z.enum([
  "finstat",
  "ruz",
  "rpvs",
  "crz",
  "registry",
  "people",
  "history",
  "rpo",
  "ai",
]);

export type ImportSourceId = z.infer<typeof SOURCE_ENUM>;

export const ALL_SOURCES: readonly ImportSourceId[] = [
  "finstat",
  "ruz",
  "rpvs",
  "crz",
  "registry",
  "people",
  "history",
  "rpo",
  "ai",
] as const;

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

export interface QueueStats {
  pending: number;
  running: number;
  success: number;
  failed: number;
}

export interface QueueItem {
  id: string;
  ico: string;
  source: string;
  status: string;
  priority: number;
  attempts: number;
  lastError: string | null;
  forceRefresh: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface EnqueueResult {
  enqueued: number;
  skippedDuplicates: number;
}

export interface BatchProgress {
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  errors: Array<{ ico: string; source: string; error: string }>;
}

const enqueueSchema = z.object({
  icos: z.array(z.string().regex(/^\d{6,8}$/)).min(1).max(500),
  sources: z.array(SOURCE_ENUM).min(1),
  priority: z.number().int().min(1).max(10).default(5),
  forceRefresh: z.boolean().default(false),
});

export const enqueueImportsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => enqueueSchema.parse(input))
  .handler(async ({ data, context }): Promise<EnqueueResult> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let enqueued = 0;
    let skipped = 0;

    for (const ico of data.icos) {
      for (const source of data.sources) {
        // Skip if an identical active job exists.
        const { data: dup } = await supabaseAdmin
          .from("import_queue")
          .select("id")
          .eq("ico", ico)
          .eq("source", source)
          .in("status", ["pending", "running"])
          .limit(1);
        if (dup && dup.length > 0) {
          skipped += 1;
          continue;
        }
        const { error } = await supabaseAdmin.from("import_queue").insert({
          ico,
          source,
          status: "pending",
          priority: data.priority,
          force_refresh: data.forceRefresh,
        });
        if (error) {
          // Unique index race — treat as skipped duplicate.
          skipped += 1;
        } else {
          enqueued += 1;
        }
      }
    }
    return { enqueued, skippedDuplicates: skipped };
  });

const searchEnqueueSchema = z.object({
  query: z.string().min(2).max(200),
  sources: z.array(SOURCE_ENUM).min(1),
  priority: z.number().int().min(1).max(10).default(5),
  forceRefresh: z.boolean().default(false),
  limit: z.number().int().min(1).max(20).default(10),
});

export interface SearchEnqueueResult {
  matched: Array<{ ico: string; name: string }>;
  enqueued: number;
  skippedDuplicates: number;
}

export const searchAndEnqueueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => searchEnqueueSchema.parse(input))
  .handler(async ({ data, context }): Promise<SearchEnqueueResult> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { finstatSearchByName, getFinstatEnvStatus } = await import("./finstat.server");
    if (!getFinstatEnvStatus().allSet) {
      throw new Error("Finstat API nie je nakonfigurované.");
    }
    const hits = await finstatSearchByName(data.query);
    const matched = hits
      .slice(0, data.limit)
      .map((h) => ({ ico: h.ico, name: h.name }))
      .filter((h) => /^\d{6,8}$/.test(h.ico));

    let enqueued = 0;
    let skipped = 0;
    for (const hit of matched) {
      for (const source of data.sources) {
        const { data: dup } = await supabaseAdmin
          .from("import_queue")
          .select("id")
          .eq("ico", hit.ico)
          .eq("source", source)
          .in("status", ["pending", "running"])
          .limit(1);
        if (dup && dup.length > 0) {
          skipped += 1;
          continue;
        }
        const { error } = await supabaseAdmin.from("import_queue").insert({
          ico: hit.ico,
          source,
          status: "pending",
          priority: data.priority,
          force_refresh: data.forceRefresh,
        });
        if (error) skipped += 1;
        else enqueued += 1;
      }
    }
    return { matched, enqueued, skippedDuplicates: skipped };
  });

const processSchema = z.object({ limit: z.number().int().min(1).max(100).default(10) });

export const processImportQueueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => processSchema.parse(input))
  .handler(async ({ data, context }): Promise<BatchProgress> => {
    await assertAdmin(context.supabase, context.userId);
    const { processQueueBatch } = await import("./datahub.server");
    const res = await processQueueBatch(data.limit);
    return {
      processed: res.processed,
      successful: res.successful,
      failed: res.failed,
      skipped: res.skipped,
      errors: res.errors,
    };
  });

export const getQueueStatsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<QueueStats> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const statuses: Array<keyof QueueStats> = ["pending", "running", "success", "failed"];
    const stats: QueueStats = { pending: 0, running: 0, success: 0, failed: 0 };
    await Promise.all(
      statuses.map(async (s) => {
        const { count } = await supabaseAdmin
          .from("import_queue")
          .select("id", { count: "exact", head: true })
          .eq("status", s);
        stats[s] = count ?? 0;
      }),
    );
    return stats;
  });

const listSchema = z.object({
  status: z.enum(["pending", "running", "success", "failed"]).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const getQueueItemsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<QueueItem[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("import_queue")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      ico: r.ico,
      source: r.source,
      status: r.status,
      priority: r.priority ?? 5,
      attempts: r.attempts ?? 0,
      lastError: r.last_error,
      forceRefresh: r.force_refresh ?? false,
      createdAt: r.created_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    }));
  });

export const retryFailedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ requeued: number }> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: failed, error } = await supabaseAdmin
      .from("import_queue")
      .select("id, ico, source")
      .eq("status", "failed")
      .limit(500);
    if (error) throw new Error(error.message);
    if (!failed || failed.length === 0) return { requeued: 0 };

    let requeued = 0;
    for (const row of failed) {
      // Only requeue if no active job for same (ico, source) exists.
      const { data: dup } = await supabaseAdmin
        .from("import_queue")
        .select("id")
        .eq("ico", row.ico)
        .eq("source", row.source)
        .in("status", ["pending", "running"])
        .limit(1);
      if (dup && dup.length > 0) continue;
      const { error: updErr } = await supabaseAdmin
        .from("import_queue")
        .update({
          status: "pending",
          started_at: null,
          finished_at: null,
          last_error: null,
        })
        .eq("id", row.id);
      if (!updErr) requeued += 1;
    }
    return { requeued };
  });

export const clearSuccessFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ deleted: number }> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("import_queue")
      .delete()
      .eq("status", "success")
      .select("id");
    if (error) throw new Error(error.message);
    return { deleted: data?.length ?? 0 };
  });
