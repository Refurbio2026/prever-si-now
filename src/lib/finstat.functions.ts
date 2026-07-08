// Client-safe module: only createServerFn declarations + client-safe imports.
// Server-only helpers (Finstat client, service-role admin) are loaded inside
// each handler via `await import(...)` so they never enter the client bundle.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { CompanySearchResult } from "./types";
import type { CompanyDetailBundle } from "./finstat.server";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — detail cache
const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — search cache
const ALLOW_MOCK = process.env.NODE_ENV !== "production";

const searchSchema = z.object({ query: z.string().min(1).max(200) });
const icoSchema = z.object({ ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO") });

export type SearchResponse =
  | { ok: true; results: CompanySearchResult[]; source: "finstat" | "cache"; mode: "ico" | "name" }
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

// In-memory 1h search cache. Server workers are stateless across cold starts
// but this still cuts repeated calls within one warm instance.
const searchCache = new Map<string, { at: number; result: SearchResponse }>();

function searchCacheGet(key: string): SearchResponse | null {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return { ...hit.result, source: "cache" } as SearchResponse;
}

function searchCacheSet(key: string, result: SearchResponse): void {
  searchCache.set(key, { at: Date.now(), result });
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
      companyToSearchResult,

      mockCompanyDetail,
      getFinstatEnvStatus,
      FinstatError,
    } = await import("./finstat.server");

    const isIcoQuery = /^\d{8}$/.test(query) || looksLikeIco(query);
    const mode: "ico" | "name" = isIcoQuery ? "ico" : "name";
    const cacheKey = `${mode}:${query.toLowerCase()}`;
    const cached = searchCacheGet(cacheKey);
    if (cached) return cached;

    if (!getFinstatEnvStatus().allSet) {
      if (!ALLOW_MOCK) {
        return {
          ok: false,
          error: "Finstat API nie je nakonfigurované.",
          code: "missing_credentials",
        };
      }
      const mock = mockCompanyDetail(isIcoQuery ? query : "31333532").company;
      return {
        ok: true,
        results: [companyToSearchResult(mock)],
        source: "cache",
        mode,
      };
    }

    try {
      let result: SearchResponse;
      if (isIcoQuery) {
        const raw = await finstatGetByIco(query);
        result = {
          ok: true,
          results: [companyToSearchResult(normalizeCompany(raw))],
          source: "finstat",
          mode,
        };
      } else {
        const hits = await finstatSearchByName(query);
        result = {
          ok: true,
          results: hits.slice(0, 20),
          source: "finstat",
          mode,
        };

      }
      searchCacheSet(cacheKey, result);
      return result;
    } catch (err) {
      if (err instanceof FinstatError && err.code === "not_found") {
        const result: SearchResponse = { ok: true, results: [], source: "finstat", mode };
        searchCacheSet(cacheKey, result);
        return result;
      }
      if (
        err instanceof FinstatError &&
        (err.code === "missing_credentials" || err.code === "unauthorized")
      ) {
        if (!ALLOW_MOCK) return toErrorResponse(err);
        const mock = mockCompanyDetail(isIcoQuery ? query : "31333532").company;
        return {
          ok: true,
          results: [companyToSearchResult(mock)],
          source: "cache",
          mode,
        };
      }
      return toErrorResponse(err);
    }
  });

const diagnosticSchema = z.object({
  ico: z.string().regex(/^\d{6,8}$/).default("31333532"),
});

export type FinstatDiagnosticResponse = {
  ok: true;
  diagnostic: import("./finstat.server").FinstatDiagnostic;
};

export const finstatDiagnosticFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => diagnosticSchema.parse(input ?? {}))
  .handler(async ({ data }): Promise<FinstatDiagnosticResponse> => {
    const { runFinstatDiagnostic } = await import("./finstat.server");
    const diagnostic = await runFinstatDiagnostic(data.ico);
    return { ok: true, diagnostic };
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
