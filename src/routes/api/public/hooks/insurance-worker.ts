// Public scheduler endpoint for insurance-debt imports.
// Called by pg_cron on a daily cadence. Runs all four provider importers
// (`social_insurance`, `vszp`, `dovera`, `union`). Providers without a
// stable public dataset return `not_implemented` and never emit signals.
// Never exposes company or user data — only aggregate counts.
// Requires the shared X-Datahub-Secret header (DATAHUB_CRON_SECRET).

import { createFileRoute } from "@tanstack/react-router";
import { verifyDatahubSecret } from "@/lib/hooks-auth.server";

async function run(request: Request): Promise<Response> {
  const denied = verifyDatahubSecret(request);
  if (denied) return denied;
  const startedAt = new Date();
  try {
    const { importAllInsuranceDebtors } = await import("@/lib/insurance-debt.server");
    const results = await importAllInsuranceDebtors();
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

export const Route = createFileRoute("/api/public/hooks/insurance-worker")({
  server: {
    handlers: {
      GET: ({ request }) => run(request),
      POST: ({ request }) => run(request),
    },
  },
});
