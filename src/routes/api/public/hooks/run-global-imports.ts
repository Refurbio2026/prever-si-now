// Daily global DataHub imports. Called by pg_cron once a day. Requires the
// shared X-Datahub-Secret header. Chains Social Insurance → Tax debtors →
// VAT register sequentially; each step is independent and never blocks the
// next. Returns a JSON summary. Idempotency handled via a lock row in
// datahub_settings — a second concurrent call exits early.

import { createFileRoute } from "@tanstack/react-router";
import { verifyDatahubSecret } from "@/lib/hooks-auth.server";

async function run(request: Request): Promise<Response> {
  const denied = await verifyDatahubSecret(request);
  if (denied) return denied;
  const { runGlobalImports } = await import("@/lib/global-imports.server");
  const summary = await runGlobalImports();
  return Response.json(summary, { status: summary.ok ? 200 : 207 });
}

export const Route = createFileRoute("/api/public/hooks/run-global-imports")({
  server: {
    handlers: {
      GET: ({ request }) => run(request),
      POST: ({ request }) => run(request),
    },
  },
});
