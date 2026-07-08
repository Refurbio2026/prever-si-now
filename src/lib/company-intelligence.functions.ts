// Client-safe module: only createServerFn declarations + client-safe imports.
// The multi-source aggregation runs entirely inside the handler.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { CompanyIntelligence, FieldMergeAudit, ProviderDiagnostic } from "./providers/types";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEV = process.env.NODE_ENV !== "production";

const icoSchema = z.object({ ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO") });

export type CompanyIntelligenceResponse =
  | { ok: true; data: CompanyIntelligence; source: "providers" | "cache" }
  | { ok: false; error: string; code: string };

/** Best-effort cache access. Never throws — cache is optional infrastructure,
 *  the profile must still load if Supabase env is not configured. */
async function readCache(ico: string): Promise<CompanyIntelligence | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("company_cache")
      .select("data, fetched_at")
      .eq("ico", ico)
      .maybeSingle();
    if (!data) return null;
    const age = Date.now() - new Date(data.fetched_at).getTime();
    if (age > CACHE_TTL_MS) return null;
    return data.data as unknown as CompanyIntelligence;
  } catch {
    return null;
  }
}

async function writeCache(ico: string, intel: CompanyIntelligence): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("company_cache").upsert(
      {
        ico,
        data: intel as unknown as never,
        fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ico" },
    );
  } catch {
    // ignore — cache is best-effort
  }
}

export const getCompanyIntelligenceFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<CompanyIntelligenceResponse> => {
    const ico = data.ico;
    const {
      runCompanyProvider,
      runFinancialProvider,
      runRiskProvider,
      runPeopleProvider,
      runContractsProvider,
      runMonitoringProvider,
      runStatementsProvider,
    } = await import("./providers/aggregate.server");

    const { finstatFetchAll } = await import("./providers/finstat.provider.server");

    const cached = await readCache(ico);
    if (cached) return { ok: true, data: cached, source: "cache" };

    const diagnostics: ProviderDiagnostic[] = [];

    let finstat: Awaited<ReturnType<typeof finstatFetchAll>>;
    try {
      finstat = await finstatFetchAll(ico, DEV ? diagnostics : undefined);
    } catch (err) {
      const e = err as Error;
      return {
        ok: false,
        error: e.message ?? "Neočakávaná chyba pri načítaní z Finstat.",
        code: "finstat_failed",
      };
    }

    const [company, financials, statements, risks, contracts, monitoring] =
      await Promise.all([
        runCompanyProvider(ico, finstat, DEV ? diagnostics : undefined),
        runFinancialProvider(ico, finstat),
        runStatementsProvider(ico, DEV ? diagnostics : undefined),
        runRiskProvider(ico, finstat),
        runContractsProvider(ico),
        runMonitoringProvider(ico),
      ]);

    // People run after company so ORSR statutory reps flow into the merge.
    const people = await runPeopleProvider(
      ico,
      finstat,
      company.registry?.statutoryRepresentatives ?? [],
    );

    const sources = [
      ...company.sources,
      ...financials.sources,
      ...statements.sources,
      ...risks.sources,
      ...people.sources,
      ...contracts.sources,
      ...monitoring.sources,
    ];

    const intel: CompanyIntelligence = {
      ico,
      company: company.data,
      financials: financials.data,
      statements: statements.data,
      people: people.data,
      risks: risks.data,
      contracts: contracts.data,
      monitoring: monitoring.data,
      registry: company.registry,
      sources,
      partial: sources.some((s) => s.state !== "ok" && s.state !== "empty"),
      cachedAt: new Date().toISOString(),
      diagnostics: DEV ? diagnostics : undefined,
    };


    // Only cache successful, non-empty results.
    if (intel.company) {
      await writeCache(ico, intel);
    }

    return { ok: true, data: intel, source: "providers" };
  });
