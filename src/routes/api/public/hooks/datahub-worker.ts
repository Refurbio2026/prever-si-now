// Public HTTP endpoint for the DataHub background worker.
// Anonymous — safe to call from pg_cron or an external scheduler. Never
// exposes company or user data; only returns aggregate counters.

import { createFileRoute } from "@tanstack/react-router";

async function runWorker(limit: number) {
  const { processQueueBatch } = await import("@/lib/datahub.server");
  try {
    const res = await processQueueBatch(limit);
    return Response.json({ ok: true, ...res });
  } catch (err) {
    return Response.json(
      { ok: false, error: (err as Error).message ?? "Worker crashed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/hooks/datahub-worker")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const raw = Number(url.searchParams.get("limit") ?? "25");
        const limit = Number.isFinite(raw) ? Math.min(Math.max(1, raw), 25) : 25;
        return runWorker(limit);
      },
      POST: async ({ request }) => {
        const url = new URL(request.url);
        let body: { limit?: number } = {};
        try {
          body = (await request.json()) as { limit?: number };
        } catch {
          body = {};
        }
        const raw = Number(url.searchParams.get("limit") ?? body.limit ?? 25);
        const limit = Number.isFinite(raw) ? Math.min(Math.max(1, raw), 25) : 25;
        return runWorker(limit);
      },
    },
  },
});
