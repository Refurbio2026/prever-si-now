// Runs a SINGLE global-import step in its own Worker invocation.
// Called by run-global-imports.ts so that each step (social insurance,
// tax debtors, VAT register) has an independent CPU/wall-time budget.
// If SP eats its budget and the Worker gets killed, VAT still runs
// because it's dispatched via a separate fetch to this endpoint.
// Requires the shared X-Datahub-Secret header.

import { createFileRoute } from "@tanstack/react-router";
import { verifyDatahubSecret } from "@/lib/hooks-auth.server";

type StepId = "social_insurance" | "tax_debtors" | "vat_registered";

const ALLOWED: readonly StepId[] = ["social_insurance", "tax_debtors", "vat_registered"];

async function run(request: Request): Promise<Response> {
  const denied = await verifyDatahubSecret(request);
  if (denied) return denied;

  let step: StepId | null = null;
  try {
    const body = (await request.json()) as { step?: string };
    if (body?.step && (ALLOWED as readonly string[]).includes(body.step)) {
      step = body.step as StepId;
    }
  } catch {
    /* body optional / malformed → 400 below */
  }
  if (!step) {
    return Response.json(
      { ok: false, error: "Missing or invalid 'step' field" },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    if (step === "social_insurance") {
      const { importOneProvider } = await import("@/lib/insurance-debt.server");
      const r = await importOneProvider("social_insurance");
      return Response.json({
        ok: r.status === "success" || r.status === "unchanged" || r.status === "empty",
        step,
        status: r.status ?? null,
        errorMessage: r.errorMessage ?? null,
        recordsInserted: r.recordsInserted,
        recordsUpdated: r.recordsUpdated,
        recordsUnchanged: r.recordsUnchanged,
        recordsDeactivated: r.recordsDeactivated,
        durationMs: Date.now() - startedAt,
      });
    }
    const { importOneDataset } = await import("@/lib/tax-status.server");
    const dataset = step === "tax_debtors" ? "tax_debtors" : "vat_registered";
    const r = await importOneDataset(dataset);
    return Response.json({
      ok:
        step === "tax_debtors"
          ? r.status !== "failed" && r.status !== "crashed"
          : r.status === "success" || r.status === "unchanged" || r.status === "empty",
      step,
      status: r.status ?? null,
      errorMessage: r.errorMessage ?? null,
      recordsInserted: r.recordsInserted,
      recordsUpdated: r.recordsUpdated,
      recordsUnchanged: r.recordsUnchanged,
      recordsDeactivated: r.recordsDeactivated,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Step crashed";
    return Response.json(
      {
        ok: false,
        step,
        status: "crashed",
        errorMessage: message,
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/hooks/run-import-step")({
  server: {
    handlers: {
      POST: ({ request }) => run(request),
    },
  },
});
