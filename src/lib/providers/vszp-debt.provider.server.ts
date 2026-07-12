// Všeobecná zdravotná poisťovňa (VšZP) — public debtor list via
// Slovensko.Digital DataHub mirror.
//
// Endpoint (paginated via Link: rel="next", 100 rows/page):
//   GET https://datahub.ekosystem.slovensko.digital/api/data/vszp/debtors/sync
// Optional query: ?since=<ISO8601> for incremental sync.
//
// Rate limit: 60 req/min upstream — throttle to ~50 req/min (1.2s between pages).
// IMPORTANT: upstream `id` changes on daily rebuild; we NEVER key on it — the
// reconcile pipeline uses (ico, provider) and per-record hash derived from
// (cin, name, amount, published_on).
//
// Gated by env flag VSZP_IMPORT_ENABLED=true (licensing pending).

import { createHash } from "node:crypto";
import {
  type ImporterOutcome,
  type InsuranceDebtRecord,
  type JsonValue,
  normalizeIco,
} from "@/lib/insurance-debt.types";

const LANDING_URL =
  "https://datahub.ekosystem.slovensko.digital/dataset/vszp-debtors";
const API_URL =
  "https://datahub.ekosystem.slovensko.digital/api/data/vszp/debtors/sync";
const PAGE_DELAY_MS = 1_200; // 50 req/min
const PAGE_TIMEOUT_MS = 30_000;
const MAX_PAGES = 5_000;

interface VszpRow {
  id?: number | string;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
  amount?: number | string | null;
  payer_type?: string | null;
  cin?: string | null;
  health_care_claim?: string | null;
  published_on?: string | null;
}

function logVszp(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[datahub] VSZP ${message}`);
}

function logVszpError(message: string, err?: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    `[datahub] VSZP ${message}`,
    err instanceof Error ? (err.stack ?? err.message) : (err ?? ""),
  );
}

function parseLinkNext(header: string | null): string | null {
  if (!header) return null;
  // Standard Link: <url>; rel="next", <url>; rel="prev"
  const parts = header.split(",");
  for (const p of parts) {
    const m = /<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i.exec(p);
    if (m) return m[1];
  }
  return null;
}

function parseAmount(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function fetchPage(url: string): Promise<{ rows: VszpRow[]; next: string | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "PreverSi DataHub (+https://preversi.sk)",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const rows = (await res.json()) as VszpRow[];
    return { rows: Array.isArray(rows) ? rows : [], next: parseLinkNext(res.headers.get("link")) };
  } finally {
    clearTimeout(t);
  }
}

/** Read the last successful full sync date from data_freshness so we can
 *  request an incremental delta with ?since=<ISO>. Best-effort — falls back
 *  to a full sync if nothing found. */
async function readSince(): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("data_freshness")
      .select("last_success_at")
      .eq("ico", "__GLOBAL__")
      .eq("source", "vszp")
      .maybeSingle<{ last_success_at: string | null }>();
    return data?.last_success_at ?? null;
  } catch {
    return null;
  }
}

export async function importVszpDebtors(): Promise<ImporterOutcome> {
  const base: ImporterOutcome = {
    provider: "vszp",
    status: "failed",
    sourceUrl: LANDING_URL,
    recordsDownloaded: 0,
    recordsNormalized: 0,
    recordsWithIco: 0,
    contentHash: null,
    errorMessage: null,
    records: [],
    sourceRecordDate: null,
  };

  const enabled =
    (process.env.VSZP_IMPORT_ENABLED ?? "").trim().toLowerCase() === "true";
  if (!enabled) {
    return {
      ...base,
      status: "not_implemented",
      errorMessage:
        "Import VšZP je dočasne vypnutý (VSZP_IMPORT_ENABLED=false, čaká sa na licenciu).",
    };
  }

  try {
    const since = await readSince();
    const startUrl = since ? `${API_URL}?since=${encodeURIComponent(since)}` : API_URL;
    logVszp(`start GET url=${startUrl}`);

    const all: VszpRow[] = [];
    const hasher = createHash("sha256");
    let url: string | null = startUrl;
    let page = 0;
    while (url && page < MAX_PAGES) {
      const { rows, next } = await fetchPage(url);
      for (const r of rows) all.push(r);
      hasher.update(JSON.stringify(rows));
      page++;
      if ((page % 20) === 0) logVszp(`page=${page} accumulated=${all.length}`);
      url = next;
      if (url) await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
    const contentHash = hasher.digest("hex");
    logVszp(`downloaded rows=${all.length} pages=${page} hash=${contentHash.slice(0, 12)}`);

    const sourceRecordDate = new Date().toISOString().slice(0, 10);
    const records: InsuranceDebtRecord[] = [];
    let withIco = 0;
    for (const r of all) {
      const ico = normalizeIco(r.cin ?? null);
      if (ico) withIco++;
      if (!ico) continue; // individuals — skip reconciliation, no ICO to match
      const addressParts = [r.address, r.postal_code, r.city]
        .map((v) => (v ?? "").toString().trim())
        .filter((v) => v.length > 0);
      const raw: JsonValue = (r as unknown) as JsonValue;
      records.push({
        ico,
        provider: "vszp",
        debtorFound: true,
        debtAmount: parseAmount(r.amount ?? null),
        currency: "EUR",
        debtorName: (r.name ?? "")?.toString().trim() || null,
        address: addressParts.join(", ") || null,
        sourceRecordDate: r.published_on ?? sourceRecordDate,
        sourceUrl: LANDING_URL,
        rawData: raw,
      });
    }
    logVszp(`normalized records=${records.length} withIco=${withIco}`);

    return {
      provider: "vszp",
      status: records.length === 0 ? "empty" : "success",
      sourceUrl: LANDING_URL,
      recordsDownloaded: all.length,
      recordsNormalized: records.length,
      recordsWithIco: withIco,
      contentHash,
      errorMessage: null,
      records,
      sourceRecordDate,
    };
  } catch (err) {
    logVszpError("importer error", err);
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timeout ${PAGE_TIMEOUT_MS} ms pri sťahovaní VšZP datasetu.`
          : err.message
        : "Neznáma chyba pri sťahovaní VšZP datasetu.";
    return { ...base, errorMessage: msg };
  }
}
