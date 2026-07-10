// Server-only orchestrator for Financial Administration imports.
// - Loads dataset importers (tax debtors, VAT register, reliability index)
// - Upserts normalized records into `company_tax_status`
// - Writes per-run diagnostics into `tax_import_runs`
// - Updates `data_freshness` per dataset
// - Emits change signals only for watched IČOs
// Never throws — one failing dataset must not break the others.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  TAX_DATASETS,
  type JsonValue,
  type TaxDatasetId,
  type TaxImporterOutcome,
  type TaxStatusRecord,
} from "@/lib/tax-status.types";
import { importTaxDebtors } from "@/lib/providers/tax-debtors.provider.server";
import { importVatRegister } from "@/lib/providers/vat-register.provider.server";
import { importTaxReliability } from "@/lib/providers/tax-reliability.provider.server";

function admin(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

const CHUNK = 500;

async function upsertRecords(
  records: TaxStatusRecord[],
): Promise<{ upserted: number; errorMessage: string | null }> {
  if (records.length === 0) return { upserted: 0, errorMessage: null };
  let upserted = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK).map((r) => ({
      ico: r.ico,
      source_dataset: r.dataset,
      tax_debtor_found: r.taxDebtorFound,
      tax_debt_amount: r.taxDebtAmount,
      vat_registered: r.vatRegistered,
      ic_dph: r.icDph,
      vat_registration_date: r.vatRegistrationDate,
      tax_reliability_index: r.taxReliabilityIndex,
      source_record_date: r.sourceRecordDate,
      source_url: r.sourceUrl,
      raw_data: r.rawData,
    }));
    const { error } = await admin()
      .from("company_tax_status")
      .upsert(slice, { onConflict: "ico,source_dataset,source_record_date" });
    if (error) return { upserted, errorMessage: error.message };
    upserted += slice.length;
  }
  return { upserted, errorMessage: null };
}

async function writeFreshness(
  dataset: TaxDatasetId,
  ok: boolean,
  message: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await admin()
    .from("data_freshness")
    .upsert(
      {
        ico: "__GLOBAL__",
        source: `fs_${dataset}`,
        last_attempt_at: now,
        last_success_at: ok ? now : undefined,
        status: ok ? "success" : "failed",
        error_message: message,
        updated_at: now,
      },
      { onConflict: "ico,source" },
    );
}

async function latestSuccessHash(
  dataset: TaxDatasetId,
): Promise<string | null> {
  const { data } = await admin()
    .from("tax_import_runs")
    .select("content_hash")
    .eq("dataset", dataset)
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { content_hash: string | null } | null)?.content_hash ?? null;
}

async function recordRun(
  outcome: TaxImporterOutcome,
  startedAt: Date,
  overrideMessage?: string | null,
): Promise<void> {
  await admin().from("tax_import_runs").insert({
    dataset: outcome.dataset,
    status: outcome.status,
    source_url: outcome.sourceUrl,
    content_hash: outcome.contentHash,
    source_record_date: outcome.sourceRecordDate,
    records_downloaded: outcome.recordsDownloaded,
    records_normalized: outcome.recordsNormalized,
    records_with_valid_ico: outcome.recordsWithValidIco,
    error_message: overrideMessage ?? outcome.errorMessage,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
  });
}

async function detectChanges(
  dataset: TaxDatasetId,
  records: TaxStatusRecord[],
): Promise<void> {
  const { data: prev } = await admin()
    .from("company_tax_status")
    .select(
      "ico, tax_debtor_found, tax_debt_amount, vat_registered, tax_reliability_index, source_record_date",
    )
    .eq("source_dataset", dataset);

  interface PrevRow {
    ico: string;
    tax_debtor_found: boolean | null;
    tax_debt_amount: number | null;
    vat_registered: boolean | null;
    tax_reliability_index: string | null;
    source_record_date: string | null;
  }
  const prevMap = new Map<string, PrevRow>();
  for (const r of (prev as PrevRow[] | null) ?? []) {
    const existing = prevMap.get(r.ico);
    if (!existing || (r.source_record_date ?? "") > (existing.source_record_date ?? "")) {
      prevMap.set(r.ico, r);
    }
  }

  const currMap = new Map<string, TaxStatusRecord>();
  for (const r of records) if (r.ico) currMap.set(r.ico, r);

  const changes: Array<{
    ico: string;
    change_type: string;
    title: string;
    description: string;
    severity: string;
  }> = [];

  if (dataset === "tax_debtors") {
    for (const [ico, cur] of currMap) {
      const before = prevMap.get(ico);
      if (!before) {
        changes.push({
          ico,
          change_type: "tax_debt_added",
          title: "Nový daňový nedoplatok",
          description:
            cur.taxDebtAmount != null
              ? `Firma bola pridaná do zoznamu daňových dlžníkov (dlh: ${cur.taxDebtAmount.toFixed(2)} €).`
              : "Firma bola pridaná do zoznamu daňových dlžníkov.",
          severity:
            cur.taxDebtAmount != null && cur.taxDebtAmount >= 1000
              ? "critical"
              : "warning",
        });
      } else if ((before.tax_debt_amount ?? 0) !== (cur.taxDebtAmount ?? 0)) {
        changes.push({
          ico,
          change_type: "tax_debt_amount_changed",
          title: "Zmena výšky daňového nedoplatku",
          description: `Predtým ${before.tax_debt_amount ?? "n/a"} €, aktuálne ${cur.taxDebtAmount ?? "n/a"} €.`,
          severity: "warning",
        });
      }
    }
    for (const [ico] of prevMap) {
      if (!currMap.has(ico)) {
        changes.push({
          ico,
          change_type: "tax_debt_removed_from_published_list",
          title: "Firma odstránená zo zoznamu daňových dlžníkov",
          description:
            "Firma už nie je uvedená v aktuálnom zverejnenom zozname daňových dlžníkov.",
          severity: "info",
        });
      }
    }
  } else if (dataset === "vat_registered") {
    for (const [ico, cur] of currMap) {
      const before = prevMap.get(ico);
      if (!before && cur.vatRegistered === true) {
        changes.push({
          ico,
          change_type: "vat_registration_added",
          title: "Zaregistrovaný ako platiteľ DPH",
          description: "Firma je uvedená v registri platiteľov DPH.",
          severity: "info",
        });
      } else if (
        before?.vat_registered === true &&
        cur.vatRegistered === false
      ) {
        changes.push({
          ico,
          change_type: "vat_registration_removed",
          title: "Zrušená registrácia DPH",
          description:
            "Podľa oficiálneho zdroja Finančnej správy bola registrácia DPH zrušená.",
          severity: "warning",
        });
      }
    }
  } else if (dataset === "tax_reliability") {
    for (const [ico, cur] of currMap) {
      const before = prevMap.get(ico);
      if (
        cur.taxReliabilityIndex &&
        before?.tax_reliability_index !== cur.taxReliabilityIndex
      ) {
        changes.push({
          ico,
          change_type: "tax_reliability_changed",
          title: "Zmena indexu daňovej spoľahlivosti",
          description: `Nová hodnota: ${cur.taxReliabilityIndex}${before?.tax_reliability_index ? ` (predtým: ${before.tax_reliability_index}).` : "."}`,
          severity: "info",
        });
      }
    }
  }

  if (changes.length === 0) return;
  const icos = Array.from(new Set(changes.map((c) => c.ico)));
  const { data: watched } = await admin()
    .from("watched_companies")
    .select("ico")
    .in("ico", icos);
  const watchedSet = new Set(
    ((watched as Array<{ ico: string }> | null) ?? []).map((w) => w.ico),
  );
  const filtered = changes.filter((c) => watchedSet.has(c.ico));
  if (filtered.length === 0) return;
  await admin().from("company_changes").insert(filtered);
}

export interface TaxDatasetImportResult {
  dataset: TaxDatasetId;
  status: TaxImporterOutcome["status"];
  recordsUpserted: number;
  errorMessage: string | null;
}

function runImporterFor(dataset: TaxDatasetId): Promise<TaxImporterOutcome> {
  switch (dataset) {
    case "tax_debtors":
      return importTaxDebtors();
    case "vat_registered":
      return importVatRegister();
    case "tax_reliability":
      return importTaxReliability();
  }
}

export async function importOneDataset(
  dataset: TaxDatasetId,
): Promise<TaxDatasetImportResult> {
  const startedAt = new Date();
  let outcome: TaxImporterOutcome;
  try {
    outcome = await runImporterFor(dataset);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznáma chyba importu.";
    const failed: TaxImporterOutcome = {
      dataset,
      status: "failed",
      sourceUrl: "",
      recordsDownloaded: 0,
      recordsNormalized: 0,
      recordsWithValidIco: 0,
      contentHash: null,
      errorMessage: msg,
      records: [],
      sourceRecordDate: null,
    };
    await recordRun(failed, startedAt);
    await writeFreshness(dataset, false, msg);
    return { dataset, status: "failed", recordsUpserted: 0, errorMessage: msg };
  }

  // Skip when source hash unchanged since last successful run.
  if (outcome.contentHash) {
    const prevHash = await latestSuccessHash(dataset);
    if (prevHash && prevHash === outcome.contentHash) {
      const unchanged: TaxImporterOutcome = { ...outcome, status: "unchanged" };
      await recordRun(unchanged, startedAt);
      await writeFreshness(dataset, true, "Dataset nezmenený od posledného behu.");
      return {
        dataset,
        status: "unchanged",
        recordsUpserted: 0,
        errorMessage: null,
      };
    }
  }

  if (outcome.status === "not_implemented") {
    await recordRun(outcome, startedAt);
    await writeFreshness(dataset, false, outcome.errorMessage);
    return {
      dataset,
      status: "not_implemented",
      recordsUpserted: 0,
      errorMessage: outcome.errorMessage,
    };
  }

  const { upserted, errorMessage: upsertErr } = await upsertRecords(
    outcome.records,
  );
  const finalStatus: TaxImporterOutcome["status"] = upsertErr
    ? "failed"
    : outcome.status;
  const finalMessage = upsertErr ?? outcome.errorMessage;

  if (!upsertErr && outcome.records.length > 0) {
    try {
      await detectChanges(dataset, outcome.records);
    } catch {
      // Ignored — monitoring is best-effort.
    }
  }

  await recordRun(
    { ...outcome, status: finalStatus, errorMessage: finalMessage },
    startedAt,
  );
  await writeFreshness(dataset, finalStatus !== "failed", finalMessage);
  return {
    dataset,
    status: finalStatus,
    recordsUpserted: upserted,
    errorMessage: finalMessage,
  };
}

export async function importTaxDebtorsGlobal(): Promise<TaxDatasetImportResult> {
  return importOneDataset("tax_debtors");
}
export async function importVatRegisterGlobal(): Promise<TaxDatasetImportResult> {
  return importOneDataset("vat_registered");
}
export async function importTaxReliabilityGlobal(): Promise<TaxDatasetImportResult> {
  return importOneDataset("tax_reliability");
}

export async function importAllFinancialAdministrationData(): Promise<
  TaxDatasetImportResult[]
> {
  const results: TaxDatasetImportResult[] = [];
  for (const d of TAX_DATASETS) {
    try {
      results.push(await importOneDataset(d));
    } catch (err) {
      results.push({
        dataset: d,
        status: "failed",
        recordsUpserted: 0,
        errorMessage:
          err instanceof Error ? err.message : "Neznáma chyba.",
      });
    }
  }
  return results;
}

export const GLOBAL_JOB_ICO = "__GLOBAL__";
export type _JsonValueReExport = JsonValue;
