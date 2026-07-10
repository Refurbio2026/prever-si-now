// Client-safe module — server-fn declarations only. Reads normalized
// registry data from Supabase. Imports are triggered manually from the
// admin panel; the UI never calls ORSR directly.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const icoSchema = z.object({ ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO") });

export interface CompanyRegistryRecord {
  id: string;
  ico: string;
  name: string | null;
  legalForm: string | null;
  address: string | null;
  registrationDate: string | null;
  registrationNumber: string | null;
  source: string;
  importedAt: string;
}

export interface CompanyPersonRecord {
  id: string;
  ico: string;
  personName: string;
  role: string;
  validFrom: string | null;
  validTo: string | null;
  source: string;
  importedAt: string;
}

export interface CompanyHistoryRecord {
  id: string;
  ico: string;
  eventType: string;
  title: string;
  description: string | null;
  eventDate: string | null;
  source: string;
  importedAt: string;
}

export interface CompanyRecordsResponse {
  registry: CompanyRegistryRecord | null;
  people: CompanyPersonRecord[];
  history: CompanyHistoryRecord[];
}

export interface ImportJobResult {
  ok: boolean;
  imported: number;
  error?: string;
}

export interface ImportLogEntry {
  id: string;
  ico: string;
  source: string;
  status: string;
  recordsCount: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}


export const getCompanyRecordsFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<CompanyRecordsResponse> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ico = data.ico;

    const [{ data: registryRow }, { data: people }, { data: history }] = await Promise.all([
      supabaseAdmin
        .from("company_registry")
        .select("*")
        .eq("ico", ico)
        .order("imported_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("company_people")
        .select("*")
        .eq("ico", ico)
        .order("valid_from", { ascending: false, nullsFirst: false }),
      supabaseAdmin
        .from("company_history")
        .select("*")
        .eq("ico", ico)
        .order("event_date", { ascending: false, nullsFirst: false }),
    ]);

    return {
      registry: registryRow
        ? {
            id: registryRow.id,
            ico: registryRow.ico,
            name: registryRow.name,
            legalForm: registryRow.legal_form,
            address: registryRow.address,
            registrationDate: registryRow.registration_date,
            registrationNumber: registryRow.registration_number,
            source: registryRow.source,
            importedAt: registryRow.imported_at,
          }
        : null,
      people: (people ?? []).map((p) => ({
        id: p.id,
        ico: p.ico,
        personName: p.person_name,
        role: p.role,
        validFrom: p.valid_from,
        validTo: p.valid_to,
        source: p.source,
        importedAt: p.imported_at,
      })),
      history: (history ?? []).map((h) => ({
        id: h.id,
        ico: h.ico,
        eventType: h.event_type,
        title: h.title,
        description: h.description,
        eventDate: h.event_date,
        source: h.source,
        importedAt: h.imported_at,
      })),
    };
  });

async function runImport(
  ico: string,
  fn: (ico: string) => Promise<{ imported: number }>,
): Promise<ImportJobResult> {
  try {
    const res = await fn(ico);
    return { ok: true, imported: res.imported };
  } catch (err) {
    return {
      ok: false,
      imported: 0,
      error: (err as Error).message ?? "Neznáma chyba pri importe.",
    };
  }
}

export const importCompanyRegistryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<ImportJobResult> => {
    const { importCompanyRegistry } = await import("./imports.server");
    return runImport(data.ico, importCompanyRegistry);
  });

export const importCompanyPeopleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<ImportJobResult> => {
    const { importCompanyPeople } = await import("./imports.server");
    return runImport(data.ico, importCompanyPeople);
  });

export const importCompanyHistoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<ImportJobResult> => {
    const { importCompanyHistory } = await import("./imports.server");
    return runImport(data.ico, importCompanyHistory);
  });

export const getImportLogsFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ ico: z.string().regex(/^\d{6,8}$/).optional(), limit: z.number().int().min(1).max(200).optional() }).parse(input),
  )
  .handler(async ({ data }): Promise<ImportLogEntry[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("import_logs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.ico) q = q.eq("ico", data.ico);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      ico: r.ico,
      source: r.source,
      status: r.status,
      recordsCount: r.records_count ?? 0,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    }));
  });

// ---------- RPO (Register právnických osôb) ----------

export interface RpoPersonRecord {
  id: string;
  personType: "statutory_body" | "shareholder" | "founder" | "other";
  functionLabel: string | null;
  fullName: string;
  address: string | null;
  birthDate: string | null;
  shareAmount: number | null;
  shareCurrency: string | null;
  sharePercent: number | null;
  validFrom: string | null;
  validTo: string | null;
  isCurrent: boolean;
}

export interface RpoHistoryRecord {
  id: string;
  changeType:
    | "name_changed"
    | "address_changed"
    | "legal_form_changed"
    | "statutory_body_changed"
    | "shareholder_changed"
    | "other";
  fieldLabel: string | null;
  oldValue: string | null;
  newValue: string | null;
  effectiveDate: string | null;
}

export interface RpoFreshness {
  status: "success" | "failed" | "not_found" | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  errorMessage: string | null;
}

export interface RpoDataResponse {
  persons: RpoPersonRecord[];
  history: RpoHistoryRecord[];
  freshness: RpoFreshness;
}

export const getRpoDataFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<RpoDataResponse> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ico = data.ico;

    const [{ data: personRows }, { data: histRows }, { data: fresh }] = await Promise.all([
      supabaseAdmin
        .from("company_persons")
        .select("*")
        .eq("ico", ico)
        .eq("source", "rpo")
        .order("is_current", { ascending: false })
        .order("valid_from", { ascending: false, nullsFirst: false }),
      supabaseAdmin
        .from("company_registry_history")
        .select("*")
        .eq("ico", ico)
        .eq("source", "rpo")
        .order("effective_date", { ascending: false, nullsFirst: false })
        .limit(200),
      supabaseAdmin
        .from("data_freshness")
        .select("status, last_success_at, last_attempt_at, error_message")
        .eq("ico", ico)
        .eq("source", "rpo")
        .maybeSingle(),
    ]);

    return {
      persons: (personRows ?? []).map((r) => ({
        id: r.id,
        personType: r.person_type as RpoPersonRecord["personType"],
        functionLabel: r.function_label,
        fullName: r.full_name,
        address: r.address,
        birthDate: r.birth_date,
        shareAmount: r.share_amount,
        shareCurrency: r.share_currency,
        sharePercent: r.share_percent,
        validFrom: r.valid_from,
        validTo: r.valid_to,
        isCurrent: r.is_current,
      })),
      history: (histRows ?? []).map((r) => ({
        id: r.id,
        changeType: r.change_type as RpoHistoryRecord["changeType"],
        fieldLabel: r.field_label,
        oldValue: r.old_value,
        newValue: r.new_value,
        effectiveDate: r.effective_date,
      })),
      freshness: {
        status: (fresh?.status ?? null) as RpoFreshness["status"],
        lastSuccessAt: fresh?.last_success_at ?? null,
        lastAttemptAt: fresh?.last_attempt_at ?? null,
        errorMessage: fresh?.error_message ?? null,
      },
    };
  });
