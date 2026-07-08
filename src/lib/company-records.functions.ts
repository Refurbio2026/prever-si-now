// Client-safe module — server-fn declarations only. Reads normalized
// registry data from Supabase. Imports are triggered manually from the
// admin panel; the UI never calls ORSR directly.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<ImportJobResult> => {
    const { importCompanyRegistry } = await import("./imports.server");
    return runImport(data.ico, importCompanyRegistry);
  });

export const importCompanyPeopleFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<ImportJobResult> => {
    const { importCompanyPeople } = await import("./imports.server");
    return runImport(data.ico, importCompanyPeople);
  });

export const importCompanyHistoryFn = createServerFn({ method: "POST" })
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
