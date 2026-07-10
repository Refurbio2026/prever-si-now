// Shared-secret verification for /api/public/hooks/* routes.
// The secret is stored server-side as DATAHUB_CRON_SECRET and injected by
// pg_cron via the `X-Datahub-Secret` header. Timing-safe compare.

import { timingSafeEqual, createHash } from "node:crypto";

export function verifyDatahubSecret(request: Request): Response | null {
  const expected = process.env.DATAHUB_CRON_SECRET ?? "";
  if (!expected) {
    return new Response(
      JSON.stringify({ ok: false, error: "DATAHUB_CRON_SECRET not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const provided = request.headers.get("x-datahub-secret") ?? "";
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  if (!timingSafeEqual(a, b)) {
    return new Response(
      JSON.stringify({ ok: false, error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  return null;
}

/** Return the secret so trusted internal callers (admin "Run now") can invoke
 *  the same hook routes with the correct header. Server-only. */
export function getDatahubSecret(): string {
  const v = process.env.DATAHUB_CRON_SECRET ?? "";
  if (!v) throw new Error("DATAHUB_CRON_SECRET not configured");
  return v;
}
