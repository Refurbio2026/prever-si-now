// Client-safe module: only createServerFn declarations + client-safe imports.
// Server-only helpers (Finstat client, service-role admin) are loaded inside
// each handler via `await import(...)` so they never enter the client bundle.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Company } from "./types";
import type { CompanyDetailBundle } from "./finstat.server";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const searchSchema = z.object({ query: z.string().min(1).max(200) });
const icoSchema = z.object({ ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO") });

export type SearchResponse =
  | { ok: true; results: Company[]; source: "finstat" | "cache" }
  | { ok: false; error: string; code: string };

export type CompanyDetailResponse =
  | { ok: true; data: CompanyDetailBundle; source: "finstat" | "cache" }
  | { ok: false; error: string; code: string };

function toErrorResponse(err: unknown): { ok: false; error: string; code: string } {
  const anyErr = err as { code?: string; message?: string };
  return {
    ok: false,
    error: anyErr?.message ?? "Neočakávaná chyba pri komunikácii s Finstat.",
    code: anyErr?.code ?? "unknown",
  };
}

export const searchCompaniesFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => searchSchema.parse(input))
  .handler(async ({ data }): Promise<SearchResponse> => {
    const query = data.query.trim();
    if (!query) return { ok: false, error: "Zadajte hľadaný výraz.", code: "missing_query" };

    const {
      looksLikeIco,
      finstatGetByIco,
      finstatSearchByName,
      normalizeCompany,
      normalizeSearchHit,
      FinstatError,
    } = await import("./finstat.server");

    try {
      if (looksLikeIco(query)) {
        const raw = await finstatGetByIco(query);
        return { ok: true, results: [normalizeCompany(raw)], source: "finstat" };
      }
      const hits = await finstatSearchByName(query);
      return { ok: true, results: hits.slice(0, 20).map(normalizeSearchHit), source: "finstat" };
    } catch (err) {
      // Preserve typed Finstat errors; downgrade "not found" to empty ok result.
      if (err instanceof FinstatError && err.code === "not_found") {
        return { ok: true, results: [], source: "finstat" };
      }
      return toErrorResponse(err);
    }
  });

export const getCompanyByIcoFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<CompanyDetailResponse> => {
    const ico = data.ico;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Check cache
    const { data: cached, error: cacheReadErr } = await supabaseAdmin
      .from("company_cache")
      .select("data, fetched_at")
      .eq("ico", ico)
      .maybeSingle();

    if (cached && !cacheReadErr) {
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      if (age < CACHE_TTL_MS) {
        return {
          ok: true,
          data: cached.data as unknown as CompanyDetailBundle,
          source: "cache",
        };
      }
    }

    // 2. Fetch from Finstat
    const { finstatGetByIco, normalizeDetail } = await import("./finstat.server");

    try {
      const raw = await finstatGetByIco(ico);
      const bundle = normalizeDetail(raw);

      // 3. Save to cache (best-effort)
      await supabaseAdmin.from("company_cache").upsert(
        {
          ico,
          data: bundle as unknown as never,
          fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "ico" },
      );

      return { ok: true, data: bundle, source: "finstat" };
    } catch (err) {
      // If cache is stale but present, prefer serving stale data on Finstat failure.
      if (cached) {
        return {
          ok: true,
          data: cached.data as unknown as CompanyDetailBundle,
          source: "cache",
        };
      }
      return toErrorResponse(err);
    }
  });
