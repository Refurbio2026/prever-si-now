// Client-safe module: only createServerFn declarations + client-safe imports.
// The multi-source aggregation runs entirely inside the handler.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { CompanyIntelligence } from "./providers/types";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const icoSchema = z.object({ ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO") });

export type CompanyIntelligenceResponse =
  | { ok: true; data: CompanyIntelligence; source: "providers" | "cache" }
  | { ok: false; error: string; code: string };

export const getCompanyIntelligenceFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<CompanyIntelligenceResponse> => {
    const ico = data.ico;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      runCompanyProvider,
      runFinancialProvider,
      runRiskProvider,
      runPeopleProvider,
      runContractsProvider,
      runMonitoringProvider,
    } = await import("./providers/aggregate.server");
    const { finstatFetchAll } = await import("./providers/finstat.provider.server");

    // 1) cache lookup
    const { data: cached } = await supabaseAdmin
      .from("company_cache")
      .select("data, fetched_at")
      .eq("ico", ico)
      .maybeSingle();

    if (cached) {
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      if (age < CACHE_TTL_MS) {
        return { ok: true, data: cached.data as unknown as CompanyIntelligence, source: "cache" };
      }
    }

    try {
      // 2) fan out — Finstat runs once and its per-capability results feed
      //    the domain providers so we don't hit it four times.
      const finstat = await finstatFetchAll(ico);

      const [company, financials, risks, people, contracts, monitoring] = await Promise.all([
        runCompanyProvider(ico, finstat),
        runFinancialProvider(ico, finstat),
        runRiskProvider(ico, finstat),
        runPeopleProvider(ico, finstat),
        runContractsProvider(ico),
        runMonitoringProvider(ico),
      ]);

      const sources = [
        ...company.sources,
        ...financials.sources,
        ...risks.sources,
        ...people.sources,
        ...contracts.sources,
        ...monitoring.sources,
      ];

      const intel: CompanyIntelligence = {
        ico,
        company: company.data,
        financials: financials.data,
        people: people.data,
        risks: risks.data,
        contracts: contracts.data,
        monitoring: monitoring.data,
        sources,
        partial: sources.some((s) => s.state !== "ok" && s.state !== "empty"),
        cachedAt: new Date().toISOString(),
      };

      // 3) write-through cache
      await supabaseAdmin.from("company_cache").upsert(
        {
          ico,
          data: intel as unknown as never,
          fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "ico" },
      );

      return { ok: true, data: intel, source: "providers" };
    } catch (err) {
      if (cached) {
        return {
          ok: true,
          data: cached.data as unknown as CompanyIntelligence,
          source: "cache",
        };
      }
      return {
        ok: false,
        error: (err as Error).message ?? "Neočakávaná chyba pri agregácii dát.",
        code: "aggregate_failed",
      };
    }
  });
