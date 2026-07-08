// Internal monitoring provider — reads from Supabase watched_companies with
// the service-role client (aggregate stats only, no user PII in output).

import { ok, unavailable, type ProviderResult } from "./base.server";
import type { MonitoringSnapshot } from "./types";

export async function internalMonitoring(
  ico: string,
): Promise<ProviderResult<MonitoringSnapshot>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("watched_companies")
    .select("id, created_at")
    .eq("ico", ico);

  if (error) {
    // Real Supabase error — surface as "Nedostupné" in the provider grid.
    return unavailable<MonitoringSnapshot>(
      "internal",
      "monitoring",
      { isWatched: false, watchers: 0, changeCount: 0 },
      "unavailable",
      error.message,
    );
  }

  const watchers = data?.length ?? 0;
  const snapshot: MonitoringSnapshot = {
    isWatched: watchers > 0,
    watchers,
    lastCheckedAt: new Date().toISOString(),
    changeCount: 0,
  };
  return ok("internal", "monitoring", snapshot);
}

