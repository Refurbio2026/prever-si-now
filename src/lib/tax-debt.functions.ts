// Client-safe server functions for the FS tax-debtor matching subsystem.
// - Public: getCompanyTaxDebtFn (per IČO)
// - Admin: getTaxDebtMatchStatsFn, listUnmatchedTaxDebtorsFn,
//   matchTaxDebtorFn, ignoreTaxDebtorFn

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  MatchedTaxDebt,
  TaxDebtMatchStats,
  UnmatchedCandidate,
  UnmatchedTaxDebtor,
} from "@/lib/tax-debt.types";

const SOURCE = "fs_tax_debtors";

async function assertAdmin(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nemáte oprávnenie na túto akciu.");
}

const icoSchema = z.object({
  ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO"),
});

export const getCompanyTaxDebtFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<MatchedTaxDebt | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    const ico = data.ico.padStart(8, "0");
    const { data: row } = await admin
      .from("company_tax_debts")
      .select("amount, source_record_date, match_tier, match_confidence, debtor_name_raw, debtor_address_raw")
      .eq("ico", ico)
      .eq("source", SOURCE)
      .eq("is_current", true)
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!row) return null;
    const r = row as {
      amount: number | null;
      source_record_date: string | null;
      match_tier: string;
      match_confidence: number | null;
      debtor_name_raw: string | null;
      debtor_address_raw: string | null;
    };
    return {
      amount: r.amount,
      sourceRecordDate: r.source_record_date,
      matchTier: r.match_tier as MatchedTaxDebt["matchTier"],
      matchConfidence: r.match_confidence,
      debtorNameRaw: r.debtor_name_raw,
      debtorAddressRaw: r.debtor_address_raw,
    };
  });

export const getTaxDebtMatchStatsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaxDebtMatchStats> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    // Aggregate from company_tax_debts (current only) grouped by match_tier.
    const [{ data: current }, { data: unmatched }, { data: latestRun }] = await Promise.all([
      admin
        .from("company_tax_debts")
        .select("match_tier, source_record_date")
        .eq("source", SOURCE)
        .eq("is_current", true)
        .limit(50_000),
      admin
        .from("tax_debtor_unmatched")
        .select("id", { count: "exact", head: true })
        .eq("status", "unmatched"),
      admin
        .from("tax_import_runs")
        .select("started_at, source_record_date")
        .eq("dataset", "tax_debtors")
        .in("status", ["success", "success_partial", "empty"])
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const tiers = { exact: 0, fuzzy: 0, manual: 0 };
    let latestDate: string | null = null;
    for (const r of (current as Array<{ match_tier: string; source_record_date: string | null }> | null) ?? []) {
      if (r.match_tier === "exact") tiers.exact++;
      else if (r.match_tier === "fuzzy") tiers.fuzzy++;
      else if (r.match_tier === "manual") tiers.manual++;
      if (!latestDate && r.source_record_date) latestDate = r.source_record_date;
    }
    const lr = latestRun as { started_at: string; source_record_date: string | null } | null;
    // Get unmatched count via a separate head-count query
    const { count: unmatchedCount } = await admin
      .from("tax_debtor_unmatched")
      .select("*", { count: "exact", head: true })
      .eq("status", "unmatched");
    void unmatched;
    const total = tiers.exact + tiers.fuzzy + tiers.manual + (unmatchedCount ?? 0);
    return {
      totalRecords: total,
      matchedExact: tiers.exact,
      matchedFuzzy: tiers.fuzzy,
      matchedManual: tiers.manual,
      unmatched: unmatchedCount ?? 0,
      sourceRecordDate: lr?.source_record_date ?? latestDate,
      lastRunAt: lr?.started_at ?? null,
    };
  });

const listUnmatchedSchema = z.object({
  search: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const listUnmatchedTaxDebtorsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listUnmatchedSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ items: UnmatchedTaxDebtor[]; total: number }> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;

    let q = admin
      .from("tax_debtor_unmatched")
      .select(
        "id, debtor_name_raw, address_raw, psc, obec, amount, source_record_date, candidates, status, matched_ico, reviewed_at, created_at",
        { count: "exact" },
      )
      .eq("status", "unmatched")
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (data.search && data.search.trim()) {
      q = q.ilike("debtor_name_raw", `%${data.search.trim()}%`);
    }
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    const items: UnmatchedTaxDebtor[] = ((rows as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
      id: r.id as string,
      debtorNameRaw: r.debtor_name_raw as string,
      addressRaw: (r.address_raw as string | null) ?? null,
      psc: (r.psc as string | null) ?? null,
      obec: (r.obec as string | null) ?? null,
      amount: (r.amount as number | null) ?? null,
      sourceRecordDate: (r.source_record_date as string | null) ?? null,
      candidates: ((r.candidates as Array<Record<string, unknown>> | null) ?? []).map((c) => ({
        ico: c.ico as string,
        nameNormalized: (c.name_normalized as string) ?? "",
        psc: (c.psc as string | null) ?? null,
        obec: (c.obec as string | null) ?? null,
        similarity: Number(c.similarity ?? 0),
      } as UnmatchedCandidate)),
      status: r.status as UnmatchedTaxDebtor["status"],
      matchedIco: (r.matched_ico as string | null) ?? null,
      reviewedAt: (r.reviewed_at as string | null) ?? null,
      createdAt: r.created_at as string,
    }));
    return { items, total: count ?? items.length };
  });

const matchSchema = z.object({
  unmatchedId: z.string().uuid(),
  ico: z.string().regex(/^\d{6,8}$/),
});

export const matchTaxDebtorFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => matchSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    const ico = data.ico.padStart(8, "0");

    const { data: row, error: rowErr } = await admin
      .from("tax_debtor_unmatched")
      .select("id, debtor_name_raw, debtor_name_normalized, address_raw, psc, amount, source_record_date")
      .eq("id", data.unmatchedId)
      .maybeSingle();
    if (rowErr) throw new Error(rowErr.message);
    if (!row) throw new Error("Záznam nenájdený.");
    const r = row as {
      id: string;
      debtor_name_raw: string;
      debtor_name_normalized: string | null;
      address_raw: string | null;
      psc: string | null;
      amount: number | null;
      source_record_date: string | null;
    };

    const now = new Date().toISOString();
    // Close any existing current row for this ico+source
    await admin
      .from("company_tax_debts")
      .update({ is_current: false, valid_to: now })
      .eq("ico", ico)
      .eq("source", SOURCE)
      .eq("is_current", true);
    // Insert manual match
    const { error: insErr } = await admin.from("company_tax_debts").insert({
      ico,
      source: SOURCE,
      debtor_name_raw: r.debtor_name_raw,
      debtor_address_raw: r.address_raw,
      amount: r.amount,
      source_record_date: r.source_record_date,
      match_tier: "manual",
      match_confidence: 1.0,
      is_current: true,
      valid_from: now,
      first_seen_at: now,
      last_seen_at: now,
    });
    if (insErr) throw new Error(insErr.message);

    // Persist mapping for future imports
    if (r.debtor_name_normalized && r.psc) {
      await admin
        .from("tax_debtor_manual_mappings")
        .upsert(
          {
            name_normalized: r.debtor_name_normalized,
            psc: r.psc,
            ico,
            created_by: context.userId,
          },
          { onConflict: "name_normalized,psc" },
        );
    }
    // Mark unmatched row as manually_matched
    await admin
      .from("tax_debtor_unmatched")
      .update({
        status: "manually_matched",
        matched_ico: ico,
        reviewed_by: context.userId,
        reviewed_at: now,
      })
      .eq("id", data.unmatchedId);

    return { ok: true };
  });

const ignoreSchema = z.object({ unmatchedId: z.string().uuid() });

export const ignoreTaxDebtorFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ignoreSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    await admin
      .from("tax_debtor_unmatched")
      .update({
        status: "ignored",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.unmatchedId);
    return { ok: true };
  });
