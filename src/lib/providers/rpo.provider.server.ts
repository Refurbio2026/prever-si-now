// RPO (Register právnických osôb) importer with reconciliation lifecycle.
// Per-company: fetch → parse → reconcile persons + history → emit monitoring
// events → update data_freshness. Never deletes rows; closes them via
// is_current=false + removed_at.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RPO_BASE = "https://api.statistics.sk/rpo/v2";
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "PreverSi.sk/1.0 (+https://prever-si-now.lovable.app)";

// Simple in-process rate limiter: min 1s between outbound RPO requests.
let lastFetchAt = 0;
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, 1000 - (now - lastFetchAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
}

// ---------- defensive helpers ----------
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
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}
function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/\s+/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function isCurrent(entry: Record<string, unknown>): boolean {
  return entry.validTo == null || entry.validTo === "";
}

// ---------- fetch ----------
async function rpoFetch(path: string): Promise<unknown | null> {
  await rateLimit();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${RPO_BASE}${path}`, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`RPO ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

async function fetchRpoDetail(ico: string): Promise<Record<string, unknown> | null> {
  const search = await rpoFetch(`/search?identifiers=${encodeURIComponent(ico)}`);
  if (search === null) return null;
  const root = asRecord(search);
  const first = asRecord(asArray(root?.results ?? root?.data)[0]);
  if (!first) return null;
  // Follow id when statutory bodies are missing.
  if (asArray(first.statutoryBodies ?? first.statutories ?? first.statutoryOrgans).length === 0) {
    const id = asString(first.id) ?? asString(first.corporateBodyId);
    if (id) {
      try {
        const detail = asRecord(await rpoFetch(`/id/${encodeURIComponent(id)}`));
        if (detail) return detail;
      } catch {
        // fall through with search entry
      }
    }
  }
  return first;
}

// ---------- name / address helpers ----------
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
function normalizeAddress(entry: unknown): string | undefined {
  const r = asRecord(entry);
  if (!r) return undefined;
  const preformatted =
    asString(r.formatedAddress) ?? asString(r.formattedAddress) ?? asString(r.value);
  if (preformatted) return preformatted;
  const street = asString(r.street);
  const number = asString(r.buildingNumber) ?? asString(r.number);
  const zip = asString(r.postalCode) ?? asString(r.zip);
  const city = asString(r.municipality) ?? asString(r.city);
  const line = [street, number].filter(Boolean).join(" ");
  const cityLine = [zip, city].filter(Boolean).join(" ");
  const combined = [line, cityLine].filter(Boolean).join(", ");
  return combined || undefined;
}
function pickAddressFromList(list: unknown, wantCurrent = true): string | undefined {
  const arr = asArray(list);
  if (arr.length === 0) return undefined;
  const pick = wantCurrent
    ? (arr.find((e) => {
        const r = asRecord(e);
        return r && isCurrent(r);
      }) ?? arr[0])
    : arr[0];
  return normalizeAddress(pick);
}
function pickPersonAddress(entry: Record<string, unknown>): string | undefined {
  const person = asRecord(entry.person) ?? {};
  return (
    pickAddressFromList(entry.addresses) ??
    pickAddressFromList(person.addresses) ??
    normalizeAddress(entry.address) ??
    normalizeAddress(person.address)
  );
}

// ---------- rows ----------
export interface PersonRow {
  ico: string;
  source: "rpo";
  person_type: "statutory_body" | "shareholder" | "founder" | "other";
  function_label: string | null;
  full_name: string;
  address: string | null;
  birth_date: string | null;
  share_amount: number | null;
  share_currency: string | null;
  share_percent: number | null;
  valid_from: string | null;
  valid_to: string | null;
  raw_data: Record<string, unknown>;
}

function collectPersons(ico: string, detail: Record<string, unknown>): PersonRow[] {
  const rows: PersonRow[] = [];

  // Statutory bodies
  for (const b of asArray(
    detail.statutoryBodies ?? detail.statutories ?? detail.statutoryOrgans,
  )) {
    const r = asRecord(b);
    if (!r) continue;
    const name = extractPersonName(r);
    if (!name) continue;
    const person = asRecord(r.person) ?? {};
    rows.push({
      ico,
      source: "rpo",
      person_type: "statutory_body",
      function_label:
        asString(asRecord(r.function)?.value) ??
        asString(r.function) ??
        asString(r.role) ??
        null,
      full_name: name,
      address: pickPersonAddress(r) ?? null,
      birth_date: asDate(person.dateOfBirth) ?? asDate(r.birthDate) ?? null,
      share_amount: null,
      share_currency: null,
      share_percent: null,
      valid_from: asDate(r.validFrom),
      valid_to: asDate(r.validTo),
      raw_data: r,
    });
  }

  // Shareholders / founders — RPO uses several possible field names
  const shareholderLists: Array<{ items: unknown; type: "shareholder" | "founder" | "other" }> = [
    { items: detail.partners, type: "shareholder" },
    { items: detail.shareholders, type: "shareholder" },
    { items: detail.founders, type: "founder" },
    { items: detail.otherPersons, type: "other" },
  ];
  for (const { items, type } of shareholderLists) {
    for (const s of asArray(items)) {
      const r = asRecord(s);
      if (!r) continue;
      const name = extractPersonName(r);
      if (!name) continue;
      const person = asRecord(r.person) ?? {};
      const share = asRecord(r.share) ?? asRecord(r.deposit) ?? {};
      rows.push({
        ico,
        source: "rpo",
        person_type: type,
        function_label:
          asString(asRecord(r.function)?.value) ?? asString(r.function) ?? null,
        full_name: name,
        address: pickPersonAddress(r) ?? null,
        birth_date: asDate(person.dateOfBirth) ?? null,
        share_amount:
          asNumber(share.amount) ??
          asNumber(r.shareAmount) ??
          asNumber(r.depositAmount) ??
          null,
        share_currency:
          asString(share.currency) ??
          asString(r.shareCurrency) ??
          asString(r.currency) ??
          null,
        share_percent:
          asNumber(share.percent) ??
          asNumber(share.percentage) ??
          asNumber(r.sharePercent) ??
          null,
        valid_from: asDate(r.validFrom),
        valid_to: asDate(r.validTo),
        raw_data: r,
      });
    }
  }

  return rows;
}

// ---------- monitoring events ----------
interface MonitoringChange {
  ico: string;
  change_type: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
}

async function emitChanges(changes: MonitoringChange[]): Promise<void> {
  if (changes.length === 0) return;
  await supabaseAdmin.from("company_changes").insert(changes);
}

// ---------- diff & reconcile persons ----------
function keyOf(p: {
  person_type: string;
  full_name: string;
  function_label: string | null;
  valid_from: string | null;
}): string {
  return [p.person_type, p.full_name, p.function_label ?? "", p.valid_from ?? ""].join("|");
}

interface ReconcileResult {
  inserted: number;
  updated: number;
  closed: number;
  changes: MonitoringChange[];
}

async function reconcilePersons(
  ico: string,
  incoming: PersonRow[],
): Promise<ReconcileResult> {
  const now = new Date().toISOString();
  const { data: existingRows } = await supabaseAdmin
    .from("company_persons")
    .select(
      "id, person_type, full_name, function_label, valid_from, valid_to, is_current, address, share_amount, share_currency, share_percent",
    )
    .eq("ico", ico)
    .eq("source", "rpo");

  const existing = existingRows ?? [];
  const existingByKey = new Map(existing.map((e) => [keyOf(e), e]));
  const incomingKeys = new Set(incoming.map(keyOf));

  const changes: MonitoringChange[] = [];
  let inserted = 0;
  let updated = 0;
  let closed = 0;

  // Upsert incoming
  for (const row of incoming) {
    const k = keyOf(row);
    const prev = existingByKey.get(k);
    if (!prev) {
      const { error } = await supabaseAdmin.from("company_persons").insert({
        ico,
        source: "rpo",
        person_type: row.person_type,
        function_label: row.function_label,
        full_name: row.full_name,
        address: row.address,
        birth_date: row.birth_date,
        share_amount: row.share_amount,
        share_currency: row.share_currency,
        share_percent: row.share_percent,
        valid_from: row.valid_from,
        valid_to: row.valid_to,
        is_current: true,
        first_seen_at: now,
        last_seen_at: now,
        raw_data: row.raw_data,
      });
      if (!error) {
        inserted += 1;
        if (row.person_type === "statutory_body") {
          changes.push({
            ico,
            change_type: "statutory_body_changed",
            title: "V registri pribudol štatutárny zástupca",
            description: `${row.full_name}${row.function_label ? ` (${row.function_label})` : ""}`,
            severity: "info",
          });
        } else if (row.person_type === "shareholder" || row.person_type === "founder") {
          changes.push({
            ico,
            change_type: "shareholder_changed",
            title: "V registri pribudol spoločník",
            description: row.full_name,
            severity: "info",
          });
        }
      }
    } else {
      const patch: Record<string, unknown> = {
        last_seen_at: now,
        is_current: true,
        removed_at: null,
      };
      if (prev.address !== row.address) patch.address = row.address;
      if (prev.share_amount !== row.share_amount) patch.share_amount = row.share_amount;
      if (prev.share_currency !== row.share_currency) patch.share_currency = row.share_currency;
      if (prev.share_percent !== row.share_percent) patch.share_percent = row.share_percent;
      const { error } = await supabaseAdmin
        .from("company_persons")
        .update(patch)
        .eq("id", prev.id);
      if (!error) updated += 1;
    }
  }

  // Close rows that were previously current but are no longer present
  for (const prev of existing) {
    if (!prev.is_current) continue;
    if (incomingKeys.has(keyOf(prev))) continue;
    const { error } = await supabaseAdmin
      .from("company_persons")
      .update({ is_current: false, removed_at: now, valid_to: prev.valid_to ?? now.slice(0, 10) })
      .eq("id", prev.id);
    if (!error) {
      closed += 1;
      if (prev.person_type === "statutory_body") {
        changes.push({
          ico,
          change_type: "statutory_body_changed",
          title: "Zo štatutárneho orgánu bola odstránená osoba",
          description: `${prev.full_name}${prev.function_label ? ` (${prev.function_label})` : ""}`,
          severity: "info",
        });
      } else if (prev.person_type === "shareholder" || prev.person_type === "founder") {
        changes.push({
          ico,
          change_type: "shareholder_changed",
          title: "Zo zoznamu spoločníkov bola odstránená osoba",
          description: prev.full_name,
          severity: "info",
        });
      }
    }
  }

  return { inserted, updated, closed, changes };
}

// ---------- registry history diff ----------
interface HistoryRow {
  ico: string;
  source: "rpo";
  change_type:
    | "name_changed"
    | "address_changed"
    | "legal_form_changed"
    | "statutory_body_changed"
    | "shareholder_changed"
    | "other";
  field_label: string | null;
  old_value: string | null;
  new_value: string | null;
  effective_date: string | null;
}

function diffValidityList(
  ico: string,
  list: unknown,
  changeType: HistoryRow["change_type"],
  fieldLabel: string,
  valueFn: (r: Record<string, unknown>) => string | undefined,
): HistoryRow[] {
  const entries = asArray(list)
    .map(asRecord)
    .filter((e): e is Record<string, unknown> => !!e)
    .map((e) => ({
      value: valueFn(e) ?? "",
      from: asDate(e.validFrom),
      to: asDate(e.validTo),
    }))
    .filter((e) => e.value.length > 0)
    .sort((a, b) => (a.from ?? "").localeCompare(b.from ?? ""));

  const rows: HistoryRow[] = [];
  let prev: string | null = null;
  for (const e of entries) {
    if (prev !== null && prev !== e.value) {
      rows.push({
        ico,
        source: "rpo",
        change_type: changeType,
        field_label: fieldLabel,
        old_value: prev,
        new_value: e.value,
        effective_date: e.from,
      });
    }
    prev = e.value;
  }
  return rows;
}

function collectRegistryHistory(ico: string, detail: Record<string, unknown>): HistoryRow[] {
  const rows: HistoryRow[] = [];

  rows.push(
    ...diffValidityList(ico, detail.fullNames, "name_changed", "Obchodné meno", (r) =>
      asString(r.value),
    ),
  );
  rows.push(
    ...diffValidityList(ico, detail.addresses, "address_changed", "Sídlo", (r) =>
      normalizeAddress(r),
    ),
  );
  rows.push(
    ...diffValidityList(ico, detail.legalForms, "legal_form_changed", "Právna forma", (r) =>
      asString(r.value),
    ),
  );

  return rows;
}

async function reconcileHistory(ico: string, rows: HistoryRow[]): Promise<{
  inserted: number;
  changes: MonitoringChange[];
}> {
  if (rows.length === 0) return { inserted: 0, changes: [] };

  // Fetch existing keys to detect *new* changes for monitoring emission.
  const { data: existing } = await supabaseAdmin
    .from("company_registry_history")
    .select("change_type, field_label, old_value, new_value, effective_date")
    .eq("ico", ico)
    .eq("source", "rpo");

  const existingKeys = new Set(
    (existing ?? []).map(
      (e) =>
        `${e.change_type}|${e.field_label ?? ""}|${e.old_value ?? ""}|${e.new_value ?? ""}|${e.effective_date ?? ""}`,
    ),
  );

  const changes: MonitoringChange[] = [];
  for (const r of rows) {
    const k = `${r.change_type}|${r.field_label ?? ""}|${r.old_value ?? ""}|${r.new_value ?? ""}|${r.effective_date ?? ""}`;
    if (existingKeys.has(k)) continue;
    if (r.change_type === "name_changed") {
      changes.push({
        ico,
        change_type: "company_name_changed",
        title: "V registri sa zmenilo obchodné meno",
        description: `${r.old_value ?? "?"} → ${r.new_value ?? "?"}`,
        severity: "info",
      });
    } else if (r.change_type === "address_changed") {
      changes.push({
        ico,
        change_type: "company_address_changed",
        title: "V registri sa zmenila adresa sídla",
        description: `${r.old_value ?? "?"} → ${r.new_value ?? "?"}`,
        severity: "info",
      });
    }
  }

  const { error } = await supabaseAdmin
    .from("company_registry_history")
    .upsert(
      rows.map((r) => ({ ...r, is_current: true })),
      { onConflict: "ico,change_type,field_label,old_value,new_value,effective_date", ignoreDuplicates: true },
    );
  // Fallback: upsert with COALESCE columns doesn't map cleanly to onConflict.
  // If the upsert failed on constraint mismatch, fall back to per-row insert.
  if (error) {
    for (const r of rows) {
      await supabaseAdmin
        .from("company_registry_history")
        .insert({ ...r, is_current: true })
        .then(() => undefined, () => undefined);
    }
  }
  return { inserted: rows.length, changes };
}

// ---------- freshness ----------
async function recordFreshness(
  ico: string,
  status: "success" | "failed" | "not_found",
  message?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await supabaseAdmin.from("data_freshness").upsert(
    {
      ico,
      source: "rpo",
      last_attempt_at: now,
      last_success_at: status === "success" ? now : undefined,
      status,
      error_message: status === "success" ? null : (message ?? null),
      updated_at: now,
    },
    { onConflict: "ico,source" },
  );
}

// ---------- public entry point ----------
export interface RpoImportResult {
  imported: number;
  skipped: boolean;
  message?: string;
  personsInserted: number;
  personsUpdated: number;
  personsClosed: number;
  historyInserted: number;
  eventsEmitted: number;
}

export async function runRpoImport(ico: string): Promise<RpoImportResult> {
  let detail: Record<string, unknown> | null;
  try {
    detail = await fetchRpoDetail(ico);
  } catch (err) {
    const msg = (err as Error).message ?? "RPO fetch error";
    await recordFreshness(ico, "failed", msg);
    throw err;
  }

  if (!detail) {
    await recordFreshness(ico, "not_found", "Entita sa v RPO nenachádza.");
    return {
      imported: 0,
      skipped: true,
      message: "not_found",
      personsInserted: 0,
      personsUpdated: 0,
      personsClosed: 0,
      historyInserted: 0,
      eventsEmitted: 0,
    };
  }

  // Sanity: verify ICO matches when the response echoes it
  const returnedIco =
    asString(detail.ico) ??
    asString(asRecord(asArray(detail.identifiers)[0])?.value);
  if (returnedIco && returnedIco !== ico) {
    await recordFreshness(ico, "failed", "IČO v odpovedi RPO sa nezhoduje.");
    throw new Error("IČO mismatch in RPO response");
  }

  const persons = collectPersons(ico, detail);
  const history = collectRegistryHistory(ico, detail);

  const [personRes, historyRes] = await Promise.all([
    reconcilePersons(ico, persons),
    reconcileHistory(ico, history),
  ]);

  const allChanges = [...personRes.changes, ...historyRes.changes];
  await emitChanges(allChanges);

  await recordFreshness(ico, "success");

  return {
    imported: personRes.inserted + personRes.updated + historyRes.inserted,
    skipped: false,
    personsInserted: personRes.inserted,
    personsUpdated: personRes.updated,
    personsClosed: personRes.closed,
    historyInserted: historyRes.inserted,
    eventsEmitted: allChanges.length,
  };
}
