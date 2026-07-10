// Public scheduler endpoint for insurance-debt imports.
// Called by pg_cron on a daily cadence. Runs all four provider importers
// (`social_insurance`, `vszp`, `dovera`, `union`). Providers without a
// stable public dataset return `not_implemented` and never emit signals.
// Never exposes company or user data — only aggregate counts.

import { createFileRoute } from "@tanstack/react-router";

async function run() {
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
      GET: () => run(),
      POST: () => run(),
    },
  },
});
