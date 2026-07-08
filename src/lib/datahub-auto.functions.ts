// Client-safe module — public server-fn declarations for automatic
// company data ingestion. The company profile calls these; end users
// never trigger imports manually.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** All ingestion sources tracked per IČO. Keep in sync with datahub.server. */
export const AUTO_SOURCES = [
  "finstat",
  "ruz",
  "rpvs",
  "crz",
  "registry",
  "people",
  "history",
  "ai",
] as const;
export type AutoSource = (typeof AUTO_SOURCES)[number];

/** Refresh TTL (ms) per source. Anything older is considered stale and re-enqueued. */
export const AUTO_TTL_MS: Record<AutoSource, number> = {
  finstat: 24 * 60 * 60 * 1000,
  ruz: 7 * 24 * 60 * 60 * 1000,
  rpvs: 7 * 24 * 60 * 60 * 1000,
  crz: 24 * 60 * 60 * 1000,
  registry: 30 * 24 * 60 * 60 * 1000,
  people: 30 * 24 * 60 * 60 * 1000,
  history: 30 * 24 * 60 * 60 * 1000,
  ai: 30 * 24 * 60 * 60 * 1000,
};

export interface SourceProgress {
  source: AutoSource;
  queueStatus: "idle" | "pending" | "running" | "success" | "failed";
  freshness: "fresh" | "stale" | "missing";
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  errorMessage: string | null;
}

export interface CompanyDataStatus {
  ico: string;
  sources: SourceProgress[];
  loading: boolean;
  anyFailed: boolean;
  allFresh: boolean;
}

export interface EnsureResult {
  ico: string;
  enqueued: AutoSource[];
  skipped: AutoSource[];
}

const icoSchema = z.object({ ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO") });

/**
 * Enqueue any missing or stale source imports for the given IČO.
 * Public — safe to call from anonymous visitors of a company page.
 * Never creates duplicates when a pending/running job already exists.
 */
export const ensureCompanyDataFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<EnsureResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ico = data.ico;

    const [{ data: freshRows }, { data: activeRows }] = await Promise.all([
      supabaseAdmin
        .from("data_freshness")
        .select("source, last_success_at")
        .eq("ico", ico),
      supabaseAdmin
        .from("import_queue")
        .select("source, status")
        .eq("ico", ico)
        .in("status", ["pending", "running"]),
    ]);

    const freshMap = new Map<string, string | null>();
    (freshRows ?? []).forEach((r) => freshMap.set(r.source, r.last_success_at));
    const activeSet = new Set<string>((activeRows ?? []).map((r) => r.source));

    const now = Date.now();
    const enqueued: AutoSource[] = [];
    const skipped: AutoSource[] = [];

    for (const source of AUTO_SOURCES) {
      if (activeSet.has(source)) {
        skipped.push(source);
        continue;
      }
      const lastSuccess = freshMap.get(source);
      const ageMs = lastSuccess ? now - new Date(lastSuccess).getTime() : Infinity;
      if (ageMs < AUTO_TTL_MS[source]) {
        skipped.push(source);
        continue;
      }
      const { error } = await supabaseAdmin.from("import_queue").insert({
        ico,
        source,
        status: "pending",
        priority: 5,
        force_refresh: false,
      });
      if (error) skipped.push(source);
      else enqueued.push(source);
    }

    return { ico, enqueued, skipped };
  });

/**
 * Return per-source progress for a company: freshness from data_freshness
 * plus the latest queue status. Used by the profile UI for a progress card.
 */
export const getCompanyDataStatusFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<CompanyDataStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ico = data.ico;

    const [{ data: freshRows }, { data: queueRows }] = await Promise.all([
      supabaseAdmin
        .from("data_freshness")
        .select("source, last_success_at, last_attempt_at, status, error_message")
        .eq("ico", ico),
      supabaseAdmin
        .from("import_queue")
        .select("source, status, created_at, last_error")
        .eq("ico", ico)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    const freshBySource = new Map(
      (freshRows ?? []).map((r) => [r.source, r] as const),
    );

    // For each source keep the most recent queue row.
    const latestQueue = new Map<
      string,
      { status: string; last_error: string | null }
    >();
    for (const row of queueRows ?? []) {
      if (!latestQueue.has(row.source)) {
        latestQueue.set(row.source, {
          status: row.status,
          last_error: row.last_error,
        });
      }
    }

    const now = Date.now();
    const sources: SourceProgress[] = AUTO_SOURCES.map((source) => {
      const fresh = freshBySource.get(source);
      const queue = latestQueue.get(source);
      const lastSuccessAt = fresh?.last_success_at ?? null;
      const ageMs = lastSuccessAt ? now - new Date(lastSuccessAt).getTime() : Infinity;
      const freshness: SourceProgress["freshness"] = !lastSuccessAt
        ? "missing"
        : ageMs < AUTO_TTL_MS[source]
          ? "fresh"
          : "stale";
      let queueStatus: SourceProgress["queueStatus"] = "idle";
      if (queue) {
        if (queue.status === "pending" || queue.status === "running") {
          queueStatus = queue.status;
        } else if (queue.status === "failed" && freshness !== "fresh") {
          queueStatus = "failed";
        } else if (queue.status === "success") {
          queueStatus = "success";
        }
      }
      return {
        source,
        queueStatus,
        freshness,
        lastSuccessAt,
        lastAttemptAt: fresh?.last_attempt_at ?? null,
        errorMessage: fresh?.error_message ?? queue?.last_error ?? null,
      };
    });

    const loading = sources.some(
      (s) => s.queueStatus === "pending" || s.queueStatus === "running",
    );
    const anyFailed = sources.some((s) => s.queueStatus === "failed");
    const allFresh = sources.every((s) => s.freshness === "fresh");
    return { ico, sources, loading, anyFailed, allFresh };
  });

/**
 * Scheduler-compatible worker. Processes up to 25 pending queue jobs per
 * invocation, respecting the internal rate limiter and never throwing on
 * per-job failures. Safe to call from cron or from the UI after an ensure.
 */
export const runDataHubWorkerFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const { processQueueBatch } = await import("./datahub.server");
    try {
      const res = await processQueueBatch(25);
      return { ok: true as const, ...res };
    } catch (err) {
      return {
        ok: false as const,
        error: (err as Error).message ?? "Neznáma chyba workeru.",
        processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        errors: [],
      };
    }
  },
);
