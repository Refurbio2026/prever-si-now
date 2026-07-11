// Server-only pipeline for FS tax-debtor entity matching + reconciliation.
// Runs after downloadTaxDebtors(). All heavy operations chunked at 1000 rows
// to stay well under statement_timeout. Reconciliation mirrors the insurance
// lifecycle (upsert with hash comparison, close-removed by key chunks).

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCompanyName, normalizeText, extractPsc } from "@/lib/text-normalize";
import { reportProgress, type ProgressCtx } from "@/lib/import-progress.server";
import type { RawTaxDebtorRecord } from "@/lib/providers/tax-debtors.provider.server";

const MATCH_BATCH = 200;
const UPSERT_BATCH = 1000;
const CLOSE_REMOVED_BATCH = 1000;
const KEY_PAGE = 1000;
const FUZZY_THRESHOLD = 0.9;
const SOURCE = "fs_tax_debtors";

function log(msg: string): void {
  console.log(`[datahub] tax_debt_match ${msg}`);
}

function logErr(msg: string, err?: unknown): void {
  console.error(
    `[datahub] tax_debt_match ${msg}`,
    err instanceof Error ? (err.stack ?? err.message) : (err ?? ""),
  );
}

function recordHash(r: {
  ico: string;
  amount: number | null;
  nameRaw: string;
  addressRaw: string | null;
  sourceRecordDate: string | null;
}): string {
  const parts = [
    r.ico,
    r.amount == null ? "" : String(r.amount),
    r.nameRaw,
    r.addressRaw ?? "",
    r.sourceRecordDate ?? "",
  ].join("|");
  return createHash("sha256").update(parts).digest("hex");
}

interface NormalizedInput {
  raw: RawTaxDebtorRecord;
  nameNormalized: string;
  psc: string | null;
  obec: string | null;
}

interface MatchDecision {
  input: NormalizedInput;
  tier: "exact" | "fuzzy" | "manual" | null;
  ico: string | null;
  confidence: number | null;
  candidates: Array<{
    ico: string;
    nameNormalized: string;
    psc: string | null;
    obec: string | null;
    sim: number;
  }>;
}

export interface TaxDebtMatchResult {
  errorMessage: string | null;
  totalRecords: number;
  matchedExact: number;
  matchedFuzzy: number;
  matchedManual: number;
  unmatched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deactivated: number;
}

export async function matchAndReconcileTaxDebtors(
  admin: SupabaseClient,
  runId: string,
  rawRecords: RawTaxDebtorRecord[],
  sourceRecordDate: string,
  progress?: ProgressCtx | null,
): Promise<TaxDebtMatchResult> {
  const result: TaxDebtMatchResult = {
    errorMessage: null,
    totalRecords: rawRecords.length,
    matchedExact: 0,
    matchedFuzzy: 0,
    matchedManual: 0,
    unmatched: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    deactivated: 0,
  };

  // ---------- 1. Normalize inputs ----------
  const inputs: NormalizedInput[] = [];
  for (const r of rawRecords) {
    const nameNormalized = normalizeCompanyName(r.nameRaw);
    if (!nameNormalized) continue;
    const psc = r.psc ? (extractPsc(r.psc) ?? r.psc.replace(/\s/g, "")) : null;
    const obec = normalizeText(r.obec);
    inputs.push({ raw: r, nameNormalized, psc, obec });
  }
  log(`normalized ${inputs.length}/${rawRecords.length} records`);

  // ---------- 2. Preload manual mappings ----------
  const manualMap = new Map<string, string>();
  try {
    let after: string | null = null;
    for (let page = 1; page <= 1000; page++) {
      let q = admin
        .from("tax_debtor_manual_mappings")
        .select("name_normalized, psc, ico")
        .order("name_normalized", { ascending: true })
        .limit(KEY_PAGE);
      if (after) q = q.gt("name_normalized", after);
      const { data, error } = await q;
      if (error) throw new Error(`manual mappings page ${page}: ${error.message}`);
      const rows =
        (data as Array<{ name_normalized: string; psc: string; ico: string }> | null) ?? [];
      if (rows.length === 0) break;
      for (const row of rows) manualMap.set(`${row.name_normalized}|${row.psc}`, row.ico);
      after = rows[rows.length - 1]?.name_normalized ?? null;
      if (rows.length < KEY_PAGE) break;
    }
    log(`loaded ${manualMap.size} manual mappings`);
  } catch (err) {
    logErr("manual mappings load failed", err);
  }

  // ---------- 3. Match in batches ----------
  const decisions: MatchDecision[] = [];
  const totalMatchBatches = Math.max(1, Math.ceil(inputs.length / MATCH_BATCH));
  await reportProgress(progress, {
    phase: "reconciliation",
    currentBatch: 0,
    totalBatches: totalMatchBatches,
    recordsProcessed: 0,
    recordsTotal: inputs.length,
    message: `Párovanie ${inputs.length} záznamov (${totalMatchBatches} dávok)`,
  });

  for (let i = 0; i < inputs.length; i += MATCH_BATCH) {
    const batchNo = Math.floor(i / MATCH_BATCH) + 1;
    const slice = inputs.slice(i, i + MATCH_BATCH);
    log(`match batch ${batchNo}/${totalMatchBatches} size=${slice.length}`);

    const batchDecisions = await Promise.all(
      slice.map(async (input): Promise<MatchDecision> => {
        // Manual mapping short-circuit
        if (input.psc) {
          const manualIco = manualMap.get(`${input.nameNormalized}|${input.psc}`);
          if (manualIco) {
            return {
              input,
              tier: "manual",
              ico: manualIco,
              confidence: 1.0,
              candidates: [],
            };
          }
        }

        const { data, error } = await admin.rpc("find_tax_debtor_candidates", {
          _name_normalized: input.nameNormalized,
          _psc: input.psc,
          _obec: input.obec,
          _limit: 3,
        });
        if (error) {
          return { input, tier: null, ico: null, confidence: null, candidates: [] };
        }
        const cands = (
          (data as Array<{
            ico: string;
            name_normalized: string;
            psc: string | null;
            obec: string | null;
            sim: number;
          }> | null) ?? []
        ).map((c) => ({
          ico: c.ico,
          nameNormalized: c.name_normalized,
          psc: c.psc,
          obec: c.obec,
          sim: Number(c.sim ?? 0),
        }));

        // Tier 1 (exact): name_normalized equals AND psc equals, ONE candidate.
        const exactCands = cands.filter(
          (c) => c.nameNormalized === input.nameNormalized && c.psc === input.psc && input.psc,
        );
        if (exactCands.length === 1) {
          return {
            input,
            tier: "exact",
            ico: exactCands[0].ico,
            confidence: 1.0,
            candidates: cands,
          };
        }
        if (exactCands.length >= 2) {
          return { input, tier: null, ico: null, confidence: null, candidates: cands };
        }

        // Tier 2 (fuzzy): sim>0.9 AND (psc equals OR obec equals), ONE such candidate.
        const fuzzyCands = cands.filter(
          (c) =>
            c.sim > FUZZY_THRESHOLD &&
            ((input.psc && c.psc === input.psc) || (input.obec && c.obec === input.obec)),
        );
        if (fuzzyCands.length === 1) {
          return {
            input,
            tier: "fuzzy",
            ico: fuzzyCands[0].ico,
            confidence: fuzzyCands[0].sim,
            candidates: cands,
          };
        }
        return { input, tier: null, ico: null, confidence: null, candidates: cands };
      }),
    );
    decisions.push(...batchDecisions);
    await reportProgress(progress, {
      phase: "reconciliation",
      currentBatch: batchNo,
      totalBatches: totalMatchBatches,
      recordsProcessed: decisions.length,
      recordsTotal: inputs.length,
      message: `Párovanie dávka ${batchNo}/${totalMatchBatches}`,
    });
  }

  // ---------- 4. Split matched vs unmatched ----------
  const matched: Array<{
    ico: string;
    tier: "exact" | "fuzzy" | "manual";
    confidence: number;
    input: NormalizedInput;
  }> = [];
  const unmatched: MatchDecision[] = [];
  for (const d of decisions) {
    if (d.tier && d.ico) {
      matched.push({ ico: d.ico, tier: d.tier, confidence: d.confidence ?? 0, input: d.input });
      if (d.tier === "exact") result.matchedExact++;
      else if (d.tier === "fuzzy") result.matchedFuzzy++;
      else result.matchedManual++;
    } else {
      unmatched.push(d);
      result.unmatched++;
    }
  }
  // Deduplicate by ico — keep highest confidence
  const byIco = new Map<string, (typeof matched)[number]>();
  for (const m of matched) {
    const prev = byIco.get(m.ico);
    if (!prev || m.confidence > prev.confidence) byIco.set(m.ico, m);
  }
  const dedupedMatched = [...byIco.values()];
  log(
    `matched exact=${result.matchedExact} fuzzy=${result.matchedFuzzy} manual=${result.matchedManual} unmatched=${result.unmatched} deduped=${dedupedMatched.length}`,
  );

  // ---------- 5. Upsert matched into company_tax_debts (chunked) ----------
  // Load current is_current rows for hash comparison.
  const currentByIco = new Map<string, { id: string; source_record_hash: string | null }>();
  try {
    let after: string | null = null;
    for (let page = 1; page <= 10_000; page++) {
      let q = admin
        .from("company_tax_debts")
        .select("id, ico, source_record_hash")
        .eq("source", SOURCE)
        .eq("is_current", true)
        .order("ico", { ascending: true })
        .limit(KEY_PAGE);
      if (after) q = q.gt("ico", after);
      const { data, error } = await q;
      if (error) throw new Error(`current fetch page ${page}: ${error.message}`);
      const rows =
        (data as Array<{ id: string; ico: string; source_record_hash: string | null }> | null) ??
        [];
      if (rows.length === 0) break;
      for (const r of rows)
        currentByIco.set(r.ico, { id: r.id, source_record_hash: r.source_record_hash });
      after = rows[rows.length - 1]?.ico ?? null;
      if (rows.length < KEY_PAGE) break;
    }
  } catch (err) {
    logErr("current load failed", err);
    result.errorMessage = err instanceof Error ? err.message : "current load failed";
    return result;
  }

  const now = new Date().toISOString();
  const insertRows: Array<Record<string, unknown>> = [];
  const closeIds: string[] = [];
  const touchIds: string[] = [];

  for (const m of dedupedMatched) {
    const hash = recordHash({
      ico: m.ico,
      amount: m.input.raw.amount,
      nameRaw: m.input.raw.nameRaw,
      addressRaw: m.input.raw.addressRaw,
      sourceRecordDate,
    });
    const current = currentByIco.get(m.ico);
    if (current && current.source_record_hash === hash) {
      touchIds.push(current.id);
      result.unchanged++;
      continue;
    }
    if (current) {
      closeIds.push(current.id);
      result.updated++;
    } else {
      result.inserted++;
    }
    insertRows.push({
      ico: m.ico,
      source: SOURCE,
      debtor_name_raw: m.input.raw.nameRaw,
      debtor_address_raw: m.input.raw.addressRaw,
      amount: m.input.raw.amount,
      source_record_date: sourceRecordDate,
      match_tier: m.tier,
      match_confidence: m.confidence,
      source_record_hash: hash,
      valid_from: now,
      is_current: true,
      first_seen_at: now,
      last_seen_at: now,
    });
  }

  // Close outdated rows (chunked)
  for (let i = 0; i < closeIds.length; i += UPSERT_BATCH) {
    const slice = closeIds.slice(i, i + UPSERT_BATCH);
    const { error } = await admin
      .from("company_tax_debts")
      .update({ is_current: false, valid_to: now })
      .in("id", slice);
    if (error) {
      result.errorMessage = `close outdated: ${error.message}`;
      return result;
    }
  }
  // Insert new/updated rows (chunked)
  for (let i = 0; i < insertRows.length; i += UPSERT_BATCH) {
    const batchNo = Math.floor(i / UPSERT_BATCH) + 1;
    const totalB = Math.ceil(insertRows.length / UPSERT_BATCH);
    const slice = insertRows.slice(i, i + UPSERT_BATCH);
    log(`insert batch ${batchNo}/${totalB} rows=${slice.length}`);
    const { error } = await admin.from("company_tax_debts").insert(slice);
    if (error) {
      result.errorMessage = `insert batch ${batchNo}: ${error.message}`;
      return result;
    }
  }
  // Touch unchanged rows (last_seen_at) — chunked
  for (let i = 0; i < touchIds.length; i += UPSERT_BATCH) {
    const slice = touchIds.slice(i, i + UPSERT_BATCH);
    await admin.from("company_tax_debts").update({ last_seen_at: now }).in("id", slice);
  }

  // ---------- 6. Close removed (icos in current but not in matched) ----------
  const matchedIcos = new Set(dedupedMatched.map((m) => m.ico));
  const removedIcos: string[] = [];
  for (const ico of currentByIco.keys()) {
    if (!matchedIcos.has(ico)) removedIcos.push(ico);
  }
  log(`close-removed count=${removedIcos.length}`);
  for (let i = 0; i < removedIcos.length; i += CLOSE_REMOVED_BATCH) {
    const batchNo = Math.floor(i / CLOSE_REMOVED_BATCH) + 1;
    const totalB = Math.ceil(removedIcos.length / CLOSE_REMOVED_BATCH);
    const slice = removedIcos.slice(i, i + CLOSE_REMOVED_BATCH);
    log(`close-removed chunk ${batchNo}/${totalB} keys=${slice.length}`);
    const { data, error } = await admin.rpc("close_removed_tax_debt_keys", {
      _source: SOURCE,
      _icos: slice,
    });
    if (error) {
      result.errorMessage = `close_removed chunk ${batchNo}: ${error.message}`;
      return result;
    }
    result.deactivated += Number(data ?? 0);
  }

  // ---------- 7. Persist unmatched for admin review (chunked upsert) ----------
  // Clear previous unmatched with status='unmatched' — keep manually_matched/ignored
  try {
    // Delete all prior "unmatched" so we don't accumulate stale rows.
    // Paginate to respect statement_timeout.
    for (let p = 0; p < 1000; p++) {
      const { data, error } = await admin
        .from("tax_debtor_unmatched")
        .select("id")
        .eq("status", "unmatched")
        .limit(KEY_PAGE);
      if (error) throw new Error(`prev unmatched page ${p}: ${error.message}`);
      const rows = (data as Array<{ id: string }> | null) ?? [];
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);
      const { error: delErr } = await admin.from("tax_debtor_unmatched").delete().in("id", ids);
      if (delErr) throw new Error(`prev unmatched delete: ${delErr.message}`);
      if (rows.length < KEY_PAGE) break;
    }
  } catch (err) {
    logErr("prev unmatched cleanup failed", err);
  }

  const unmatchedRows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const u of unmatched) {
    const key = `${u.input.nameNormalized}|${u.input.psc ?? ""}|${sourceRecordDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unmatchedRows.push({
      run_id: runId,
      debtor_name_raw: u.input.raw.nameRaw,
      debtor_name_normalized: u.input.nameNormalized,
      address_raw: u.input.raw.addressRaw,
      psc: u.input.psc,
      obec: u.input.obec,
      amount: u.input.raw.amount,
      source_record_date: sourceRecordDate,
      candidates: u.candidates.slice(0, 3).map((c) => ({
        ico: c.ico,
        name_normalized: c.nameNormalized,
        psc: c.psc,
        obec: c.obec,
        similarity: c.sim,
      })),
      status: "unmatched",
    });
  }
  for (let i = 0; i < unmatchedRows.length; i += UPSERT_BATCH) {
    const batchNo = Math.floor(i / UPSERT_BATCH) + 1;
    const totalB = Math.ceil(unmatchedRows.length / UPSERT_BATCH);
    const slice = unmatchedRows.slice(i, i + UPSERT_BATCH);
    log(`unmatched insert ${batchNo}/${totalB} rows=${slice.length}`);
    const { error } = await admin
      .from("tax_debtor_unmatched")
      .upsert(slice, { onConflict: "debtor_name_normalized,psc,source_record_date" });
    if (error) {
      logErr(`unmatched insert ${batchNo} failed`, error);
      // non-fatal
    }
  }

  // ---------- 8. Monitoring events for watched companies ----------
  try {
    await emitTaxDebtChanges(admin, currentByIco, matchedIcos);
  } catch (err) {
    logErr("monitoring events failed", err);
  }

  return result;
}

async function emitTaxDebtChanges(
  admin: SupabaseClient,
  currentByIco: Map<string, unknown>,
  newMatchedIcos: Set<string>,
): Promise<void> {
  const prevIcos = new Set(currentByIco.keys());
  const added: string[] = [];
  const removed: string[] = [];
  for (const ico of newMatchedIcos) if (!prevIcos.has(ico)) added.push(ico);
  for (const ico of prevIcos) if (!newMatchedIcos.has(ico)) removed.push(ico);
  if (added.length === 0 && removed.length === 0) return;

  // Only emit for watched companies (batched).
  const watchedSet = new Set<string>();
  let after: string | null = null;
  for (let p = 0; p < 10_000; p++) {
    let q = admin
      .from("watched_companies")
      .select("ico")
      .order("ico", { ascending: true })
      .limit(KEY_PAGE);
    if (after) q = q.gt("ico", after);
    const { data, error } = await q;
    if (error) return;
    const rows = (data as Array<{ ico: string }> | null) ?? [];
    if (rows.length === 0) break;
    for (const r of rows) watchedSet.add(r.ico);
    after = rows[rows.length - 1]?.ico ?? null;
    if (rows.length < KEY_PAGE) break;
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const ico of added) {
    if (!watchedSet.has(ico)) continue;
    rows.push({
      ico,
      change_type: "tax_debt_added",
      title: "Pridaný do zoznamu daňových dlžníkov",
      description:
        "V zverejnenom zozname daňových dlžníkov pribudol záznam priradený k spoločnosti podľa zhody názvu a adresy.",
      severity: "warning",
    });
  }
  for (const ico of removed) {
    if (!watchedSet.has(ico)) continue;
    rows.push({
      ico,
      change_type: "tax_debt_removed_from_list",
      title: "Odstránený zo zoznamu daňových dlžníkov",
      description:
        "V zverejnenom zozname daňových dlžníkov ubudol záznam priradený k spoločnosti podľa zhody názvu a adresy.",
      severity: "info",
    });
  }
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    await admin.from("company_changes").insert(rows.slice(i, i + UPSERT_BATCH));
  }
}
