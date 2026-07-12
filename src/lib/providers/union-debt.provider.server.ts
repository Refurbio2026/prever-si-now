// Union zdravotná poisťovňa — public debtor list.
// Source: internal REST endpoint behind the SPA at
//   https://portal.unionzp.sk/pub/dlznici
// Requires HTTP Basic auth (secret UNION_DEBTORS_BASIC_AUTH, base64 "user:pass").
// Paginated POST with count=1000; first response reports totalRows.

import { createHash } from "node:crypto";
import {
  type ImporterOutcome,
  type InsuranceDebtRecord,
  type JsonValue,
  normalizeIco,
} from "@/lib/insurance-debt.types";

const LANDING_URL = "https://portal.unionzp.sk/pub/dlznici";
const API_URL = "https://portal.unionzp.sk/ehip-server/rest/debtors";
const PAGE_SIZE = 1000;
const PAGE_DELAY_MS = 400;
const PAGE_TIMEOUT_MS = 30_000;
const MAX_PAGES = 500; // safety cap ≈ 500k rows

interface UnionRow {
  dlznikId?: number | string;
  rplNazov?: string | null;
  rplIco?: string | null;
  suma?: number | string | null;
  typZs?: string | null;
  obec?: string | null;
  pscCislo?: string | null;
  ulicaCislo?: string | null;
}

interface UnionResponse {
  totalRows?: number;
  rows?: UnionRow[];
  data?: UnionRow[]; // fallback field name
}

function logUnion(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[datahub] Union ${message}`);
}

function logUnionError(message: string, err?: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    `[datahub] Union ${message}`,
    err instanceof Error ? (err.stack ?? err.message) : (err ?? ""),
  );
}

async function fetchPage(
  start: number,
  auth: string,
): Promise<UnionResponse> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Basic ${auth}`,
        Origin: "https://portal.unionzp.sk",
        Referer: LANDING_URL,
        "User-Agent": "PreverSi DataHub (+https://preversi.sk)",
      },
      body: JSON.stringify({
        order: { ascending: false, property: "dlznikId" },
        count: PAGE_SIZE,
        start,
        vyhladavaciRetazec: "",
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as UnionResponse;
  } finally {
    clearTimeout(t);
  }
}

function parseAmount(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function importUnionDebtors(): Promise<ImporterOutcome> {
  const base: ImporterOutcome = {
    provider: "union",
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

  const auth = process.env.UNION_DEBTORS_BASIC_AUTH?.trim();
  if (!auth) {
    return {
      ...base,
      status: "not_implemented",
      errorMessage:
        "Chýba tajný kľúč UNION_DEBTORS_BASIC_AUTH (Basic auth pre Union portál).",
    };
  }

  try {
    logUnion(`start POST url=${API_URL}`);
    const first = await fetchPage(0, auth);
    const total = Number(first.totalRows ?? 0);
    logUnion(`totalRows=${total}`);
    if (!Number.isFinite(total) || total <= 0) {
      return {
        ...base,
        status: "empty",
        contentHash: createHash("sha256").update("empty").digest("hex"),
        errorMessage: "Zdroj Union nevrátil žiadne záznamy.",
      };
    }

    const all: UnionRow[] = [];
    const hasher = createHash("sha256");
    const consumePage = (resp: UnionResponse) => {
      const rows = resp.rows ?? resp.data ?? [];
      for (const r of rows) all.push(r);
      hasher.update(JSON.stringify(rows));
    };
    consumePage(first);

    const pages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);
    for (let p = 1; p < pages; p++) {
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      const resp = await fetchPage(p * PAGE_SIZE, auth);
      consumePage(resp);
      if ((p % 10) === 0) logUnion(`page=${p}/${pages} accumulated=${all.length}`);
    }
    const contentHash = hasher.digest("hex");
    logUnion(`downloaded rows=${all.length} hash=${contentHash.slice(0, 12)}`);

    const sourceRecordDate = new Date().toISOString().slice(0, 10);
    const records: InsuranceDebtRecord[] = [];
    let withIco = 0;
    for (const r of all) {
      const ico = normalizeIco(r.rplIco ?? null);
      if (ico) withIco++;
      // Skip records without ICO — cannot be matched to a company profile.
      if (!ico) continue;
      const addressParts = [r.ulicaCislo, r.pscCislo, r.obec]
        .map((v) => (v ?? "").toString().trim())
        .filter((v) => v.length > 0);
      const raw: JsonValue = (r as unknown) as JsonValue;
      records.push({
        ico,
        provider: "union",
        debtorFound: true,
        debtAmount: parseAmount(r.suma ?? null),
        currency: "EUR",
        debtorName: (r.rplNazov ?? "")?.toString().trim() || null,
        address: addressParts.join(", ") || null,
        sourceRecordDate,
        sourceUrl: LANDING_URL,
        rawData: raw,
      });
    }
    logUnion(`normalized records=${records.length} withIco=${withIco}`);

    return {
      provider: "union",
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
    logUnionError("importer error", err);
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timeout ${PAGE_TIMEOUT_MS} ms pri sťahovaní Union datasetu.`
          : err.message
        : "Neznáma chyba pri sťahovaní Union datasetu.";
    return { ...base, errorMessage: msg };
  }
}
