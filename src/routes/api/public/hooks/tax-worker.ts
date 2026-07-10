// Public scheduler endpoint for Financial Administration imports.
// Called by pg_cron on a daily cadence. Runs all three datasets
// (tax debtors, VAT register, tax reliability). Datasets whose source URL
// is not configured return `not_implemented`. Never exposes company data.
// Requires the shared X-Datahub-Secret header (DATAHUB_CRON_SECRET).

import { createFileRoute } from "@tanstack/react-router";
import { verifyDatahubSecret } from "@/lib/hooks-auth.server";

async function run(request: Request): Promise<Response> {
  const denied = verifyDatahubSecret(request);
  if (denied) return denied;
  const startedAt = new Date();
  try {
    const { importAllFinancialAdministrationData } = await import(
      "@/lib/tax-status.server"
    );
    const results = await importAllFinancialAdministrationData();
    return Response.json({
      ok: true,
      durationMs: Date.now() - startedAt.getTime(),
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Worker crashed";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/tax-worker")({
  server: {
    handlers: {
      GET: ({ request }) => run(request),
      POST: ({ request }) => run(request),
    },
  },
});
