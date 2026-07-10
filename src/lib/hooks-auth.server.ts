// Shared-secret verification for /api/public/hooks/* routes.
// The secret is stored in `datahub_settings.cron_secret` (admin-only,
// service_role read) and is used by pg_cron in the X-Datahub-Secret header.
// Cached in memory per-worker for 60s to avoid a DB round-trip on every tick.

import { timingSafeEqual, createHash } from "node:crypto";

let cache: { value: string; expiresAt: number } | null = null;

async function loadSecret(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;
  const envValue = process.env.DATAHUB_CRON_SECRET ?? "";
  if (envValue) {
    cache = { value: envValue, expiresAt: now + 60_000 };
    return envValue;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("datahub_settings")
    .select("cron_secret")
    .eq("id", true)
    .maybeSingle<{ cron_secret: string | null }>();
  const value = data?.cron_secret ?? "";
  cache = { value, expiresAt: now + 60_000 };
  return value;
}

export async function verifyDatahubSecret(
  request: Request,
): Promise<Response | null> {
  const expected = await loadSecret();
  if (!expected) {
    return new Response(
      JSON.stringify({ ok: false, error: "DataHub cron secret not configured" }),
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
