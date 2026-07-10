// Client-safe server functions for the Financial Administration subsystem.
// - Company profile: getCompanyTaxStatusFn (public, per IČO)
// - Admin dashboard: getTaxImportStatusFn, runTaxImportFn,
//   runAllTaxImportsFn (admin-only)

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  TAX_DATASETS,
  TAX_DATASET_LABEL,
  TAX_REFRESH_MS,
  type CompanyReliabilityState,
  type CompanyTaxDebtorState,
  type CompanyTaxPayload,
  type CompanyVatState,
  type TaxDatasetId,
} from "@/lib/tax-status.types";

const icoSchema = z.object({
  ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO"),
});
const datasetSchema = z.object({ dataset: z.enum(TAX_DATASETS) });

async function assertAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nemáte oprávnenie na túto akciu.");
}

interface TaxRow {
  source_dataset: string;
  tax_debtor_found: boolean | null;
  tax_debt_amount: number | null;
  vat_registered: boolean | null;
  ic_dph: string | null;
  vat_registration_date: string | null;
  tax_reliability_index: string | null;
  source_record_date: string | null;
  source_url: string | null;
  imported_at: string;
}

interface RunRow {
  dataset: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
  source_url: string | null;
  source_record_date: string | null;
}

function isFresh(dataset: TaxDatasetId, iso: string | null | undefined): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < TAX_REFRESH_MS[dataset] * 2;
}

function debtorStateFrom(
  latest: TaxRow | undefined,
  lastSuccess: RunRow | undefined,
  lastAny: RunRow | undefined,
): CompanyTaxDebtorState {
  if (latest && latest.tax_debtor_found) {
    return {
      kind: "debt_found",
      amount: latest.tax_debt_amount,
      recordDate: latest.source_record_date,
    };
  }
  if (
    !lastSuccess ||
    (lastAny &&
      (lastAny.status === "failed" || lastAny.status === "not_implemented"))
  ) {
    return {
      kind: "unverified",
      reason: lastAny?.error_message ?? "Import zatiaľ neprebehol.",
    };
  }
  if (!isFresh("tax_debtors", lastSuccess.started_at)) {
    return { kind: "unverified", reason: "Posledný úspešný import je zastaraný." };
  }
  return { kind: "not_in_list", recordDate: lastSuccess.source_record_date };
}

function vatStateFrom(
  latestFs: TaxRow | undefined,
  finstatVat: { icDph: string | null; registered: boolean | null } | null,
  lastSuccess: RunRow | undefined,
  lastAny: RunRow | undefined,
): CompanyVatState {
  // 1) Financial Administration confirmed registration wins.
  if (latestFs?.vat_registered === true) {
    return {
      kind: "registered",
      icDph: latestFs.ic_dph,
      registrationDate: latestFs.vat_registration_date,
      source: "financial_administration",
    };
  }
  // Explicit official cancellation.
  if (latestFs?.vat_registered === false) {
    return { kind: "cancelled", recordDate: latestFs.source_record_date };
  }
  // 2) Finstat fallback — only positive, never negative.
  if (finstatVat?.registered === true || finstatVat?.icDph) {
    return {
      kind: "registered",
      icDph: finstatVat.icDph,
      registrationDate: null,
      source: "finstat",
    };
  }
  // 3) Unknown / unverified.
  if (
    !lastSuccess ||
    (lastAny &&
      (lastAny.status === "failed" || lastAny.status === "not_implemented"))
  ) {
    return {
      kind: "unverified",
      reason: lastAny?.error_message ?? "Register DPH zatiaľ nebol importovaný.",
    };
  }
  return { kind: "unknown" };
}

function reliabilityStateFrom(
  latest: TaxRow | undefined,
  lastSuccess: RunRow | undefined,
  lastAny: RunRow | undefined,
): CompanyReliabilityState {
  if (latest?.tax_reliability_index) {
    return {
      kind: "classified",
      value: latest.tax_reliability_index,
      recordDate: latest.source_record_date,
    };
  }
  if (
    !lastSuccess ||
    (lastAny &&
      (lastAny.status === "failed" || lastAny.status === "not_implemented"))
  ) {
    return {
      kind: "unverified",
      reason: lastAny?.error_message ?? "Index sa zatiaľ nepodarilo overiť.",
    };
  }
  return { kind: "not_classified" };
}

export const getCompanyTaxStatusFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<CompanyTaxPayload> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    const ico = data.ico.padStart(8, "0");

    const [{ data: rowsData }, { data: runsData }, { data: finstatData }] =
      await Promise.all([
        admin
          .from("company_tax_status")
          .select(
            "source_dataset, tax_debtor_found, tax_debt_amount, vat_registered, ic_dph, vat_registration_date, tax_reliability_index, source_record_date, source_url, imported_at",
          )
          .eq("ico", ico)
          .eq("is_current", true)
          .order("imported_at", { ascending: false })
          .limit(50),
        admin
          .from("tax_import_runs")
          .select(
            "dataset, status, started_at, finished_at, error_message, source_url, source_record_date",
          )
          .order("started_at", { ascending: false })
          .limit(200),
        // Finstat fallback for VAT (from company_registry.finstat_data JSONB
        // if present); guarded — table may not have it, ignore errors.
        admin
          .from("company_registry")
          .select("finstat_data")
          .eq("ico", ico)
          .maybeSingle(),
      ]);

    const latest = new Map<TaxDatasetId, TaxRow>();
    for (const row of (rowsData as TaxRow[] | null) ?? []) {
      const d = row.source_dataset as TaxDatasetId;
      if (!TAX_DATASETS.includes(d)) continue;
      if (!latest.has(d)) latest.set(d, row);
    }
    const lastAny = new Map<TaxDatasetId, RunRow>();
    const lastSuccess = new Map<TaxDatasetId, RunRow>();
    for (const row of (runsData as RunRow[] | null) ?? []) {
      const d = row.dataset as TaxDatasetId;
      if (!TAX_DATASETS.includes(d)) continue;
      if (!lastAny.has(d)) lastAny.set(d, row);
      if (
        !lastSuccess.has(d) &&
        (row.status === "success" ||
          row.status === "empty" ||
          row.status === "unchanged")
      ) {
        lastSuccess.set(d, row);
      }
    }

    const finstatVat = ((): { icDph: string | null; registered: boolean | null } | null => {
      const fd = (finstatData as { finstat_data: unknown } | null)?.finstat_data;
      if (!fd || typeof fd !== "object") return null;
      const obj = fd as Record<string, unknown>;
      const ic =
        typeof obj.IcDPH === "string"
          ? obj.IcDPH
          : typeof obj.icDph === "string"
            ? obj.icDph
            : null;
      const reg = ic ? true : null;
      return { icDph: ic, registered: reg };
    })();

    const debtorLatest = latest.get("tax_debtors");
    const vatLatest = latest.get("vat_registered");
    const relLatest = latest.get("tax_reliability");

    const debtor = {
      state: debtorStateFrom(
        debtorLatest,
        lastSuccess.get("tax_debtors"),
        lastAny.get("tax_debtors"),
      ),
      sourceUrl: debtorLatest?.source_url ?? null,
      lastImportAt: lastAny.get("tax_debtors")?.started_at ?? null,
      lastSuccessAt: lastSuccess.get("tax_debtors")?.started_at ?? null,
      sourceRecordDate:
        lastSuccess.get("tax_debtors")?.source_record_date ??
        debtorLatest?.source_record_date ??
        null,
    };
    const vat = {
      state: vatStateFrom(
        vatLatest,
        finstatVat,
        lastSuccess.get("vat_registered"),
        lastAny.get("vat_registered"),
      ),
      sourceUrl: vatLatest?.source_url ?? null,
      lastImportAt: lastAny.get("vat_registered")?.started_at ?? null,
      lastSuccessAt: lastSuccess.get("vat_registered")?.started_at ?? null,
      sourceRecordDate:
        lastSuccess.get("vat_registered")?.source_record_date ??
        vatLatest?.source_record_date ??
        null,
    };
    const reliability = {
      state: reliabilityStateFrom(
        relLatest,
        lastSuccess.get("tax_reliability"),
        lastAny.get("tax_reliability"),
      ),
      sourceUrl: relLatest?.source_url ?? null,
      lastImportAt: lastAny.get("tax_reliability")?.started_at ?? null,
      lastSuccessAt: lastSuccess.get("tax_reliability")?.started_at ?? null,
      sourceRecordDate:
        lastSuccess.get("tax_reliability")?.source_record_date ??
        relLatest?.source_record_date ??
        null,
    };

    return { ico, debtor, vat, reliability };
  });

export interface TaxRunSummary {
  id: string;
  dataset: TaxDatasetId;
  status: string;
  recordsDownloaded: number;
  recordsNormalized: number;
  recordsWithValidIco: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  sourceUrl: string | null;
  sourceRecordDate: string | null;
  contentHash: string | null;
}

export interface TaxDatasetStatus {
  dataset: TaxDatasetId;
  label: string;
  lastAttempt: TaxRunSummary | null;
  lastSuccess: TaxRunSummary | null;
  totalRecords: number;
}

export interface TaxAdminStatus {
  datasets: TaxDatasetStatus[];
  recentRuns: TaxRunSummary[];
}

interface AdminRunRow {
  id: string;
  dataset: string;
  status: string;
  records_downloaded: number | null;
  records_normalized: number | null;
  records_with_valid_ico: number | null;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
  source_url: string | null;
  source_record_date: string | null;
  content_hash: string | null;
}

function mapRun(row: AdminRunRow): TaxRunSummary {
  return {
    id: row.id,
    dataset: row.dataset as TaxDatasetId,
    status: row.status,
    recordsDownloaded: row.records_downloaded ?? 0,
    recordsNormalized: row.records_normalized ?? 0,
    recordsWithValidIco: row.records_with_valid_ico ?? 0,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    sourceUrl: row.source_url,
    sourceRecordDate: row.source_record_date,
    contentHash: row.content_hash,
  };
}

export const getTaxImportStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaxAdminStatus> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;

    const [{ data: runs }, { data: counts }] = await Promise.all([
      admin
        .from("tax_import_runs")
        .select(
          "id, dataset, status, records_downloaded, records_normalized, records_with_valid_ico, started_at, finished_at, error_message, source_url, source_record_date, content_hash",
        )
        .order("started_at", { ascending: false })
        .limit(100),
      admin.from("company_tax_status").select("source_dataset, ico"),
    ]);

    const mapped: TaxRunSummary[] = ((runs as AdminRunRow[] | null) ?? []).map(
      mapRun,
    );

    const countMap = new Map<TaxDatasetId, number>();
    for (const row of (counts as Array<{ source_dataset: string }> | null) ?? []) {
      const d = row.source_dataset as TaxDatasetId;
      if (!TAX_DATASETS.includes(d)) continue;
      countMap.set(d, (countMap.get(d) ?? 0) + 1);
    }

    const datasets: TaxDatasetStatus[] = TAX_DATASETS.map((d) => {
      const lastAttempt = mapped.find((r) => r.dataset === d) ?? null;
      const lastSuccess =
        mapped.find(
          (r) =>
            r.dataset === d &&
            (r.status === "success" ||
              r.status === "empty" ||
              r.status === "unchanged"),
        ) ?? null;
      return {
        dataset: d,
        label: TAX_DATASET_LABEL[d],
        lastAttempt,
        lastSuccess,
        totalRecords: countMap.get(d) ?? 0,
      };
    });

    return { datasets, recentRuns: mapped.slice(0, 40) };
  });

export const runTaxImportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => datasetSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { importOneDataset } = await import("@/lib/tax-status.server");
    return importOneDataset(data.dataset);
  });

export const runAllTaxImportsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { importAllFinancialAdministrationData } = await import(
      "@/lib/tax-status.server"
    );
    return importAllFinancialAdministrationData();
  });
