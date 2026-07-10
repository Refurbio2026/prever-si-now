// Server-only orchestrator for insurance-debt imports.
// Loads the per-provider importers, upserts normalized records into
// public.company_insurance_debts, and writes per-run diagnostics into
// public.insurance_import_runs. Never throws — one failing provider must
// not break the others.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  INSURANCE_PROVIDERS,
  type ImporterOutcome,
  type InsuranceDebtRecord,
  type InsuranceProviderId,
  type JsonValue,
} from "@/lib/insurance-debt.types";
import { importSocialInsuranceDebtors } from "@/lib/providers/social-insurance-debt.provider.server";
import { importVszpDebtors } from "@/lib/providers/vszp-debt.provider.server";
import { importDoveraDebtors } from "@/lib/providers/dovera-debt.provider.server";
import { importUnionDebtors } from "@/lib/providers/union-debt.provider.server";

// Untyped view over supabaseAdmin so we can access tables that were added
// after types.ts was last regenerated. All reads/writes still validate at
// runtime via Postgres constraints.
function admin(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

const CHUNK = 500;

async function upsertRecords(records: InsuranceDebtRecord[]): Promise<{
  upserted: number;
  errorMessage: string | null;
}> {
  if (records.length === 0) return { upserted: 0, errorMessage: null };
  let upserted = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK).map((r) => ({
      ico: r.ico,
      provider: r.provider,
      debtor_found: r.debtorFound,
      debt_amount: r.debtAmount,
      currency: r.currency,
      debtor_name: r.debtorName,
      address: r.address,
      source_record_date: r.sourceRecordDate,
      source_url: r.sourceUrl,
      raw_data: r.rawData,
    }));
    const { error } = await admin()
      .from("company_insurance_debts")
      .upsert(slice, { onConflict: "ico,provider,source_record_date" });
    if (error) return { upserted, errorMessage: error.message };
    upserted += slice.length;
  }
  return { upserted, errorMessage: null };
}

async function writeFreshness(
  provider: InsuranceProviderId,
  ok: boolean,
  message: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await admin()
    .from("data_freshness")
    .upsert(
      {
        ico: "__GLOBAL__",
        source: provider,
        last_attempt_at: now,
        last_success_at: ok ? now : undefined,
        status: ok ? "success" : "failed",
        error_message: message,
        updated_at: now,
      },
      { onConflict: "ico,source" },
    );
}

async function latestRunFor(
  provider: InsuranceProviderId,
): Promise<{ content_hash: string | null } | null> {
  const { data } = await admin()
    .from("insurance_import_runs")
    .select("content_hash")
    .eq("provider", provider)
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { content_hash: string | null } | null) ?? null;
}

async function detectChanges(
  provider: InsuranceProviderId,
  records: InsuranceDebtRecord[],
): Promise<void> {
  // Load previous "current" per-IČO record for this provider (latest one
  // per IČO). If a previous positive record vanishes → removed; if amount
  // changed → amount_changed; new IČO → added.
  const { data: prev } = await admin()
    .from("company_insurance_debts")
    .select("ico, debt_amount, source_record_date")
    .eq("provider", provider);
  const prevMap = new Map<string, { amount: number | null; date: string | null }>();
  for (const row of (prev as Array<{
    ico: string;
    debt_amount: number | null;
    source_record_date: string | null;
  }> | null) ?? []) {
    // Keep the newest snapshot per IČO.
    const existing = prevMap.get(row.ico);
    if (
      !existing ||
      (row.source_record_date ?? "") > (existing.date ?? "")
    ) {
      prevMap.set(row.ico, { amount: row.debt_amount, date: row.source_record_date });
    }
  }

  const currentMap = new Map<string, number | null>();
  for (const r of records) if (r.ico) currentMap.set(r.ico, r.debtAmount);

  const changes: Array<{
    ico: string;
    change_type: string;
    title: string;
    description: string;
    severity: string;
  }> = [];

  for (const [ico, amount] of currentMap) {
    const before = prevMap.get(ico);
    if (!before) {
      changes.push({
        ico,
        change_type: "insurance_debt_added",
        title: `Nový dlh voči poisťovni (${provider})`,
        description:
          amount != null
            ? `Firma bola pridaná do zverejneného zoznamu dlžníkov, dlh: ${amount.toFixed(2)} €.`
            : "Firma bola pridaná do zverejneného zoznamu dlžníkov.",
        severity: amount != null && amount >= 1000 ? "critical" : "warning",
      });
    } else if ((before.amount ?? 0) !== (amount ?? 0)) {
      changes.push({
        ico,
        change_type: "insurance_debt_amount_changed",
        title: `Zmena výšky dlhu (${provider})`,
        description: `Predtým ${before.amount ?? "n/a"} €, aktuálne ${amount ?? "n/a"} €.`,
        severity: "warning",
      });
    }
  }
  for (const [ico] of prevMap) {
    if (!currentMap.has(ico)) {
      changes.push({
        ico,
        change_type: "insurance_debt_removed_from_published_list",
        title: `Firma odstránená zo zoznamu dlžníkov (${provider})`,
        description:
          "Firma už nie je uvedená v aktuálnom zverejnenom zozname dlžníkov.",
        severity: "info",
      });
    }
  }

  // Only insert changes for IČOs we already monitor (watched_companies), to
  // avoid flooding company_changes with unwatched national list churn.
  if (changes.length === 0) return;
  const icos = Array.from(new Set(changes.map((c) => c.ico)));
  const { data: watched } = await admin()
    .from("watched_companies")
    .select("ico")
    .in("ico", icos);
  const watchedSet = new Set((watched as Array<{ ico: string }> | null ?? []).map((w) => w.ico));
  const filtered = changes.filter((c) => watchedSet.has(c.ico));
  if (filtered.length === 0) return;
  await admin().from("company_changes").insert(filtered);
}

async function recordRun(
  outcome: ImporterOutcome,
  startedAt: Date,
  extraMessage?: string,
): Promise<void> {
  await admin().from("insurance_import_runs").insert({
    provider: outcome.provider,
    status: outcome.status,
    records_downloaded: outcome.recordsDownloaded,
    records_normalized: outcome.recordsNormalized,
    records_with_ico: outcome.recordsWithIco,
    content_hash: outcome.contentHash,
    source_url: outcome.sourceUrl,
    error_message: extraMessage ?? outcome.errorMessage,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
  });
}

export interface ProviderImportResult {
  provider: InsuranceProviderId;
  status: ImporterOutcome["status"];
  recordsUpserted: number;
  errorMessage: string | null;
}

export async function importOneProvider(
  provider: InsuranceProviderId,
): Promise<ProviderImportResult> {
  const startedAt = new Date();
  let outcome: ImporterOutcome;
  try {
    outcome = await runImporterFor(provider);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznáma chyba importu.";
    const failed: ImporterOutcome = {
      provider,
      status: "failed",
      sourceUrl: "",
      recordsDownloaded: 0,
      recordsNormalized: 0,
      recordsWithIco: 0,
      contentHash: null,
      errorMessage: msg,
      records: [],
      sourceRecordDate: null,
    };
    await recordRun(failed, startedAt);
    await writeFreshness(provider, false, msg);
    return { provider, status: "failed", recordsUpserted: 0, errorMessage: msg };
  }

  // Skip when content hash matches last successful run.
  if (outcome.contentHash) {
    const prev = await latestRunFor(provider);
    if (prev?.content_hash === outcome.contentHash) {
      const unchanged: ImporterOutcome = { ...outcome, status: "unchanged" };
      await recordRun(unchanged, startedAt);
      await writeFreshness(provider, true, "Dataset nezmenený od posledného behu.");
      return {
        provider,
        status: "unchanged",
        recordsUpserted: 0,
        errorMessage: null,
      };
    }
  }

  if (outcome.status === "not_implemented") {
    await recordRun(outcome, startedAt);
    await writeFreshness(provider, false, outcome.errorMessage);
    return {
      provider,
      status: "not_implemented",
      recordsUpserted: 0,
      errorMessage: outcome.errorMessage,
    };
  }

  const { upserted, errorMessage: upsertErr } = await upsertRecords(outcome.records);
  const finalStatus: ImporterOutcome["status"] = upsertErr
    ? "failed"
    : outcome.status;
  const finalMessage = upsertErr ?? outcome.errorMessage;

  // Fire-and-forget change detection; do not fail the run if it errors.
  if (!upsertErr && outcome.records.length > 0) {
    try {
      await detectChanges(provider, outcome.records);
    } catch {
      // Ignored — monitoring is best-effort.
    }
  }

  await recordRun({ ...outcome, status: finalStatus, errorMessage: finalMessage }, startedAt);
  await writeFreshness(provider, finalStatus !== "failed", finalMessage);

  return {
    provider,
    status: finalStatus,
    recordsUpserted: upserted,
    errorMessage: finalMessage,
  };
}

function runImporterFor(provider: InsuranceProviderId): Promise<ImporterOutcome> {
  switch (provider) {
    case "social_insurance":
      return importSocialInsuranceDebtors();
    case "vszp":
      return importVszpDebtors();
    case "dovera":
      return importDoveraDebtors();
    case "union":
      return importUnionDebtors();
  }
}

export async function importAllInsuranceDebtors(): Promise<ProviderImportResult[]> {
  const results: ProviderImportResult[] = [];
  for (const p of INSURANCE_PROVIDERS) {
    try {
      results.push(await importOneProvider(p));
    } catch (err) {
      results.push({
        provider: p,
        status: "failed",
        recordsUpserted: 0,
        errorMessage: err instanceof Error ? err.message : "Neznáma chyba.",
      });
    }
  }
  return results;
}

// Marker used for global (non-per-IČO) queue jobs.
export const GLOBAL_JOB_ICO = "__GLOBAL__";

/** Silence unused JsonValue import warning while keeping the type surface stable. */
export type _JsonValueReExport = JsonValue;
