// Client-safe module — only server-fn declarations and pure types.
// Reads normalized `company_people` / `company_history` from Supabase and,
// if stale/empty, runs an ORSR import inside the handler. The UI never
// calls ORSR directly.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const icoSchema = z.object({ ico: z.string().regex(/^\d{6,8}$/, "Neplatné IČO") });
const FRESH_TTL_MS = 24 * 60 * 60 * 1000;

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
  people: CompanyPersonRecord[];
  history: CompanyHistoryRecord[];
  importedAt: string | null;
}

export const getCompanyRecordsFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<CompanyRecordsResponse> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ico = data.ico;

    const readAll = async () => {
      const [{ data: people }, { data: history }] = await Promise.all([
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
      return { people: people ?? [], history: history ?? [] };
    };

    let { people, history } = await readAll();

    const latestImport = [
      ...people.map((p) => p.imported_at),
      ...history.map((h) => h.imported_at),
    ]
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1);

    const stale =
      !latestImport ||
      Date.now() - new Date(latestImport).getTime() > FRESH_TTL_MS ||
      (people.length === 0 && history.length === 0);

    if (stale) {
      const { importOrsrPeople, importOrsrHistory } = await import("./imports.server");
      try {
        await Promise.all([importOrsrPeople(ico), importOrsrHistory(ico)]);
        ({ people, history } = await readAll());
      } catch {
        // best-effort import — return whatever the DB already has
      }
    }

    return {
      people: people.map((p) => ({
        id: p.id,
        ico: p.ico,
        personName: p.person_name,
        role: p.role,
        validFrom: p.valid_from,
        validTo: p.valid_to,
        source: p.source,
        importedAt: p.imported_at,
      })),
      history: history.map((h) => ({
        id: h.id,
        ico: h.ico,
        eventType: h.event_type,
        title: h.title,
        description: h.description,
        eventDate: h.event_date,
        source: h.source,
        importedAt: h.imported_at,
      })),
      importedAt: latestImport ?? null,
    };
  });

export const importOrsrPeopleFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<{ imported: number }> => {
    const { importOrsrPeople } = await import("./imports.server");
    return importOrsrPeople(data.ico);
  });

export const importOrsrHistoryFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => icoSchema.parse(input))
  .handler(async ({ data }): Promise<{ imported: number }> => {
    const { importOrsrHistory } = await import("./imports.server");
    return importOrsrHistory(data.ico);
  });
