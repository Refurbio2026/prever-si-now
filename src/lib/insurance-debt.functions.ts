// Client-safe server functions for the insurance-debt subsystem.
// - Company profile: getCompanyInsuranceDebtsFn (public, per IČO)
// - Admin dashboard: getInsuranceImportStatusFn, runInsuranceImportFn,
//   runAllInsuranceImportsFn (admin-only)

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  INSURANCE_PROVIDERS,
  INSURANCE_PROVIDER_LABEL,
  INSURANCE_REFRESH_MS,
  type CompanyInsuranceRow,
  type CompanyInsuranceState,
  type InsuranceProviderId,
} from "@/lib/insurance-debt.types";

const icoSchema = z.object({ ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO") });
const providerSchema = z.object({
  provider: z.enum(INSURANCE_PROVIDERS),
});

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

export interface CompanyInsuranceDebtsPayload {
  ico: string;
  rows: CompanyInsuranceRow[];
}

interface DebtRowShape {
  provider: string;
  debt_amount: number | null;
  debtor_name: string | null;
  address: string | null;
  source_record_date: string | null;
  source_url: string | null;
  imported_at: string;
}

interface RunRowShape {
  provider: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

function buildRow(
  provider: InsuranceProviderId,
  latestDebt: DebtRowShape | undefined,
  latestSuccessRun: RunRowShape | undefined,
  latestAnyRun: RunRowShape | undefined,
): CompanyInsuranceRow {
  let state: CompanyInsuranceState;
  if (latestDebt) {
    state = {
      kind: "debt_found",
      amount: latestDebt.debt_amount,
      recordDate: latestDebt.source_record_date,
    };
  } else if (!latestSuccessRun) {
    state = { kind: "pending" };
  } else {
    const successAt = new Date(latestSuccessRun.started_at).getTime();
    const isFresh = Date.now() - successAt < INSURANCE_REFRESH_MS[provider] * 2;
    if (!isFresh) {
      state = {
        kind: "unverified",
        reason: "Posledný úspešný import je zastaraný.",
      };
    } else {
      state = { kind: "not_in_list" };
    }
  }
  // If the most recent attempt failed AND we have no positive debt record,
  // downgrade to "unverified" so we never imply "no debt" from a failure.
  if (
    !latestDebt &&
    latestAnyRun &&
    (latestAnyRun.status === "failed" || latestAnyRun.status === "not_implemented")
  ) {
    state = {
      kind: "unverified",
      reason: latestAnyRun.error_message ?? "Import zlyhal.",
    };
  }
  return {
    provider,
    label: INSURANCE_PROVIDER_LABEL[provider],
    state,
    debtorName: latestDebt?.debtor_name ?? null,
    address: latestDebt?.address ?? null,
    sourceUrl: latestDebt?.source_url ?? null,
    lastImportAt: latestAnyRun?.started_at ?? null,
    lastSuccessAt: latestSuccessRun?.started_at ?? null,
  };
}

export const getCompanyInsuranceDebtsFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<CompanyInsuranceDebtsPayload> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    const ico = data.ico.padStart(8, "0");

    const [{ data: debts }, { data: runs }] = await Promise.all([
      admin
        .from("company_insurance_debts")
        .select(
          "provider, debt_amount, debtor_name, address, source_record_date, source_url, imported_at",
        )
        .eq("ico", ico)
        .order("imported_at", { ascending: false })
        .limit(50),
      admin
        .from("insurance_import_runs")
        .select("provider, status, started_at, finished_at, error_message")
        .order("started_at", { ascending: false })
        .limit(200),
    ]);

    const latestDebt = new Map<InsuranceProviderId, DebtRowShape>();
    for (const row of (debts as DebtRowShape[] | null) ?? []) {
      const p = row.provider as InsuranceProviderId;
      if (!INSURANCE_PROVIDERS.includes(p)) continue;
      if (!latestDebt.has(p)) latestDebt.set(p, row);
    }
    const latestAnyRun = new Map<InsuranceProviderId, RunRowShape>();
    const latestSuccessRun = new Map<InsuranceProviderId, RunRowShape>();
    for (const row of (runs as RunRowShape[] | null) ?? []) {
      const p = row.provider as InsuranceProviderId;
      if (!INSURANCE_PROVIDERS.includes(p)) continue;
      if (!latestAnyRun.has(p)) latestAnyRun.set(p, row);
      if (!latestSuccessRun.has(p) && (row.status === "success" || row.status === "empty" || row.status === "unchanged")) {
        latestSuccessRun.set(p, row);
      }
    }

    const rows = INSURANCE_PROVIDERS.map((p) =>
      buildRow(p, latestDebt.get(p), latestSuccessRun.get(p), latestAnyRun.get(p)),
    );
    return { ico, rows };
  });

export interface InsuranceRunSummary {
  id: string;
  provider: InsuranceProviderId;
  status: string;
  recordsDownloaded: number;
  recordsNormalized: number;
  recordsWithIco: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  sourceUrl: string | null;
}

export interface InsuranceProviderStatus {
  provider: InsuranceProviderId;
  label: string;
  lastAttempt: InsuranceRunSummary | null;
  lastSuccess: InsuranceRunSummary | null;
  totalDebtors: number;
}

export interface InsuranceAdminStatus {
  providers: InsuranceProviderStatus[];
  recentRuns: InsuranceRunSummary[];
}

function mapRun(row: {
  id: string;
  provider: string;
  status: string;
  records_downloaded: number | null;
  records_normalized: number | null;
  records_with_ico: number | null;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
  source_url: string | null;
}): InsuranceRunSummary {
  return {
    id: row.id,
    provider: row.provider as InsuranceProviderId,
    status: row.status,
    recordsDownloaded: row.records_downloaded ?? 0,
    recordsNormalized: row.records_normalized ?? 0,
    recordsWithIco: row.records_with_ico ?? 0,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    sourceUrl: row.source_url,
  };
}

export const getInsuranceImportStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InsuranceAdminStatus> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;

    const [{ data: runs }, { data: counts }] = await Promise.all([
      admin
        .from("insurance_import_runs")
        .select(
          "id, provider, status, records_downloaded, records_normalized, records_with_ico, started_at, finished_at, error_message, source_url",
        )
        .order("started_at", { ascending: false })
        .limit(100),
      admin
        .from("company_insurance_debts")
        .select("provider, ico"),
    ]);

    const mappedRuns: InsuranceRunSummary[] = (
      (runs as Parameters<typeof mapRun>[0][] | null) ?? []
    ).map(mapRun);

    const debtorCount = new Map<InsuranceProviderId, number>();
    for (const row of (counts as Array<{ provider: string }> | null) ?? []) {
      const p = row.provider as InsuranceProviderId;
      if (!INSURANCE_PROVIDERS.includes(p)) continue;
      debtorCount.set(p, (debtorCount.get(p) ?? 0) + 1);
    }

    const providers: InsuranceProviderStatus[] = INSURANCE_PROVIDERS.map((p) => {
      const lastAttempt = mappedRuns.find((r) => r.provider === p) ?? null;
      const lastSuccess =
        mappedRuns.find(
          (r) =>
            r.provider === p &&
            (r.status === "success" || r.status === "empty" || r.status === "unchanged"),
        ) ?? null;
      return {
        provider: p,
        label: INSURANCE_PROVIDER_LABEL[p],
        lastAttempt,
        lastSuccess,
        totalDebtors: debtorCount.get(p) ?? 0,
      };
    });

    return { providers, recentRuns: mappedRuns.slice(0, 40) };
  });

export const runInsuranceImportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => providerSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { importOneProvider } = await import("@/lib/insurance-debt.server");
    return importOneProvider(data.provider);
  });

export const runAllInsuranceImportsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { importAllInsuranceDebtors } = await import("@/lib/insurance-debt.server");
    return importAllInsuranceDebtors();
  });
