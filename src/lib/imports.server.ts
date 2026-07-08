// Server-only: ORSR / RPO import jobs that populate normalized
// `company_people` and `company_history` tables. Never imported from client
// code (blocked by the `.server.ts` filename convention).

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RPO_BASE = "https://api.statistics.sk/rpo/v2";
const REQUEST_TIMEOUT_MS = 8000;

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}
function asDate(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  // Trim to YYYY-MM-DD when ISO timestamp.
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

async function rpoFetch(path: string): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${RPO_BASE}${path}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`RPO ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

async function fetchRpoDetail(ico: string): Promise<Record<string, unknown> | undefined> {
  const search = asRecord(await rpoFetch(`/search?identifiers=${encodeURIComponent(ico)}`));
  const results = asArray(search?.results ?? search?.data);
  const first = asRecord(results[0]);
  if (!first) return undefined;
  // If statutory bodies not inlined, follow the id.
  if (asArray(first.statutoryBodies ?? first.statutories ?? first.statutoryOrgans).length === 0) {
    const id = asString(first.id) ?? asString(first.corporateBodyId);
    if (id) {
      try {
        const detail = asRecord(await rpoFetch(`/id/${encodeURIComponent(id)}`));
        if (detail) return detail;
      } catch {
        // ignore — return search entry
      }
    }
  }
  return first;
}

function extractPersonName(entry: Record<string, unknown>): string | undefined {
  const person = asRecord(entry.person) ?? entry;
  const direct =
    asString(entry.fullName) ??
    asString(entry.name) ??
    asString(person.fullName) ??
    asString(person.name);
  if (direct) return direct;
  const given = asString(person.givenName) ?? asString(person.firstName);
  const family =
    asString(person.familyName) ?? asString(person.surname) ?? asString(person.lastName);
  const composed = [given, family].filter(Boolean).join(" ").trim();
  return composed || undefined;
}

interface PeopleRow {
  ico: string;
  person_name: string;
  role: string;
  valid_from: string | null;
  valid_to: string | null;
  source: string;
  imported_at: string;
}

interface HistoryRow {
  ico: string;
  event_type: string;
  title: string;
  description: string | null;
  event_date: string | null;
  source: string;
  imported_at: string;
}

function collectPeople(ico: string, detail: Record<string, unknown>): PeopleRow[] {
  const importedAt = new Date().toISOString();
  const bodies = asArray(
    detail.statutoryBodies ?? detail.statutories ?? detail.statutoryOrgans,
  );
  const out: PeopleRow[] = [];
  for (const b of bodies) {
    const r = asRecord(b);
    if (!r) continue;
    const name = extractPersonName(r);
    if (!name) continue;
    const roleValue =
      asString(asRecord(r.function)?.value) ??
      asString(r.function) ??
      asString(r.role) ??
      "štatutárny orgán";
    out.push({
      ico,
      person_name: name,
      role: roleValue,
      valid_from: asDate(r.validFrom),
      valid_to: asDate(r.validTo),
      source: "ORSR",
      imported_at: importedAt,
    });
  }
  return out;
}

function collectHistory(ico: string, detail: Record<string, unknown>): HistoryRow[] {
  const importedAt = new Date().toISOString();
  const events: HistoryRow[] = [];

  const establishment =
    asDate(detail.establishment) ??
    asDate(detail.dateOfEstablishment) ??
    asDate(asRecord(asArray(detail.fullNames)[0])?.validFrom);
  if (establishment) {
    events.push({
      ico,
      event_type: "incorporation",
      title: "Vznik spoločnosti",
      description: "Spoločnosť bola zapísaná do obchodného registra.",
      event_date: establishment,
      source: "ORSR",
      imported_at: importedAt,
    });
  }

  const termination = asDate(detail.termination);
  if (termination) {
    events.push({
      ico,
      event_type: "termination",
      title: "Zánik spoločnosti",
      description: "Spoločnosť bola vymazaná z obchodného registra.",
      event_date: termination,
      source: "ORSR",
      imported_at: importedAt,
    });
  }

  const addressHistory = asArray(detail.addresses);
  for (const a of addressHistory) {
    const r = asRecord(a);
    if (!r) continue;
    const from = asDate(r.validFrom);
    if (!from) continue;
    const label =
      asString(r.formatedAddress) ??
      asString(r.formattedAddress) ??
      asString(r.value) ??
      "Zmena adresy sídla";
    events.push({
      ico,
      event_type: "address_changed",
      title: "Zmena adresy sídla",
      description: label,
      event_date: from,
      source: "ORSR",
      imported_at: importedAt,
    });
  }

  const nameHistory = asArray(detail.fullNames);
  for (const n of nameHistory) {
    const r = asRecord(n);
    if (!r) continue;
    const from = asDate(r.validFrom);
    const label = asString(r.value);
    if (!from || !label) continue;
    events.push({
      ico,
      event_type: "name_changed",
      title: "Zmena obchodného mena",
      description: label,
      event_date: from,
      source: "ORSR",
      imported_at: importedAt,
    });
  }

  const bodies = asArray(
    detail.statutoryBodies ?? detail.statutories ?? detail.statutoryOrgans,
  );
  for (const b of bodies) {
    const r = asRecord(b);
    if (!r) continue;
    const name = extractPersonName(r);
    if (!name) continue;
    const from = asDate(r.validFrom);
    const to = asDate(r.validTo);
    if (from) {
      events.push({
        ico,
        event_type: "statutory_added",
        title: "Nový štatutárny zástupca",
        description: name,
        event_date: from,
        source: "ORSR",
        imported_at: importedAt,
      });
    }
    if (to) {
      events.push({
        ico,
        event_type: "statutory_removed",
        title: "Ukončenie funkcie štatutárneho zástupcu",
        description: name,
        event_date: to,
        source: "ORSR",
        imported_at: importedAt,
      });
    }
  }

  const activities = asArray(detail.otherLegalFacts ?? detail.businessActivities);
  for (const a of activities) {
    const r = asRecord(a);
    if (!r) continue;
    const from = asDate(r.validFrom);
    const label = asString(r.value);
    if (!from || !label) continue;
    events.push({
      ico,
      event_type: "activity_changed",
      title: "Zmena predmetu činnosti",
      description: label,
      event_date: from,
      source: "ORSR",
      imported_at: importedAt,
    });
  }

  return events;
}

async function withLog<T extends { imported: number }>(
  ico: string,
  source: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date().toISOString();
  const { data: logRow } = await supabaseAdmin
    .from("import_logs")
    .insert({ ico, source, status: "running", started_at: startedAt })
    .select("id")
    .single();
  try {
    const res = await run();
    if (logRow) {
      await supabaseAdmin
        .from("import_logs")
        .update({
          status: "ok",
          records_count: res.imported,
          finished_at: new Date().toISOString(),
        })
        .eq("id", logRow.id);
    }
    return res;
  } catch (err) {
    const msg = (err as Error).message ?? "Neznáma chyba";
    if (logRow) {
      await supabaseAdmin
        .from("import_logs")
        .update({
          status: "error",
          error_message: msg,
          finished_at: new Date().toISOString(),
        })
        .eq("id", logRow.id);
    }
    throw err;
  }
}

export async function importCompanyPeople(ico: string): Promise<{ imported: number }> {
  return withLog(ico, "ORSR:people", async () => {
    const detail = await fetchRpoDetail(ico);
    if (!detail) return { imported: 0 };
    const rows = collectPeople(ico, detail);
    if (rows.length === 0) return { imported: 0 };
    await supabaseAdmin.from("company_people").delete().eq("ico", ico).eq("source", "ORSR");
    const { error } = await supabaseAdmin.from("company_people").insert(rows);
    if (error) throw new Error(error.message);
    return { imported: rows.length };
  });
}

export async function importCompanyHistory(ico: string): Promise<{ imported: number }> {
  return withLog(ico, "ORSR:history", async () => {
    const detail = await fetchRpoDetail(ico);
    if (!detail) return { imported: 0 };
    const rows = collectHistory(ico, detail);
    if (rows.length === 0) return { imported: 0 };
    await supabaseAdmin.from("company_history").delete().eq("ico", ico).eq("source", "ORSR");
    const { error } = await supabaseAdmin.from("company_history").insert(rows);
    if (error) throw new Error(error.message);
    return { imported: rows.length };
  });
}

export async function importCompanyRegistry(ico: string): Promise<{ imported: number }> {
  return withLog(ico, "ORSR:registry", async () => {
    const detail = await fetchRpoDetail(ico);
    if (!detail) return { imported: 0 };

    const name =
      asString(asRecord(asArray(detail.fullNames).find((e) => {
        const r = asRecord(e);
        return r && (r.validTo == null || r.validTo === "");
      }) ?? asArray(detail.fullNames)[0])?.value) ??
      asString(detail.name);

    const legalForm = asString(
      asRecord(asArray(detail.legalForms)[0])?.value ?? detail.legalForm,
    );

    const addressEntry =
      asArray(detail.addresses).find((e) => {
        const r = asRecord(e);
        return r && (r.validTo == null || r.validTo === "");
      }) ?? asArray(detail.addresses)[0];
    const addressRec = asRecord(addressEntry);
    const address =
      asString(addressRec?.formatedAddress) ??
      asString(addressRec?.formattedAddress) ??
      asString(addressRec?.value);

    const registrationDate =
      asDate(detail.establishment) ??
      asDate(detail.dateOfEstablishment) ??
      asDate(asRecord(asArray(detail.fullNames)[0])?.validFrom);

    let registrationNumber: string | null = null;
    for (const o of asArray(detail.registerOffices ?? detail.registrationOffices)) {
      const r = asRecord(o);
      if (!r) continue;
      const reg =
        asRecord(r.registrationNumber)?.value ??
        r.registrationNumber ??
        r.number ??
        r.value;
      const val = asString(reg);
      if (val) {
        registrationNumber = val;
        break;
      }
    }
    if (!registrationNumber) registrationNumber = asString(detail.registrationNumber) ?? null;

    const row = {
      ico,
      name: name ?? null,
      legal_form: legalForm ?? null,
      address: address ?? null,
      registration_date: registrationDate,
      registration_number: registrationNumber,
      source: "ORSR",
      imported_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from("company_registry")
      .upsert(row, { onConflict: "ico,source" });
    if (error) throw new Error(error.message);
    return { imported: 1 };
  });
}


