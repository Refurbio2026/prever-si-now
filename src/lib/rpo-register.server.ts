// RPO register orchestrator — download the latest RPO bulk export, upsert
// into `company_registry` (source='RPO'), refresh `company_match_keys` in
// chunks, close entries that disappeared, and (best-effort) retrigger the
// tax-debtor matching against the freshly populated register.
//
// Runs in Node with no CPU/memory/time limits. Everything is chunked at 1000
// rows so individual statements stay well under statement_timeout. Progress
// is written to datahub_import_progress after every phase so the admin UI
// shows live status.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { reportProgress, type ProgressCtx } from "@/lib/import-progress.server";
import {
  downloadRpoBatch,
  findLatestRpoBatch,
  streamRpoRecords,
  type RpoRawRecord,
} from "@/lib/providers/rpo-register.provider.server";
import { normalizeCompanyName, normalizeText } from "@/lib/text-normalize";

const SOURCE = "RPO";
const CHUNK = 1000;
const MIN_INIT_RECORDS = 500_000; // sanity: init snapshot must have this many

export interface RpoImportResult {
  status: "success" | "unchanged" | "failed" | "empty";
  errorMessage: string | null;
  batchKind: "init" | "daily" | null;
  exportDate: string | null;
  recordsParsed: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsUnchanged: number;
  recordsDeactivated: number;
  matchKeysRefreshed: number;
}

function log(msg: string): void {
  console.log(`[datahub] RPO ${msg}`);
}
function logErr(msg: string, err?: unknown): void {
  console.error(
    `[datahub] RPO ${msg}`,
    err instanceof Error ? (err.stack ?? err.message) : (err ?? ""),
  );
}

async function loadAdmin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

function recordHash(r: RpoRawRecord): string {
  const parts = [
    r.ico,
    r.name ?? "",
    r.legalForm ?? "",
    r.street ?? "",
    r.psc ?? "",
    r.obec ?? "",
    r.status,
    r.termination ?? "",
  ].join("|");
  return createHash("sha256").update(parts).digest("hex");
}

async function latestExportDate(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb
    .from("data_freshness")
    .select("last_success_at, error_message")
    .eq("ico", "__GLOBAL__")
    .eq("source", "rpo_register")
    .maybeSingle<{ last_success_at: string | null; error_message: string | null }>();
  // We stash the last exportDate into error_message on success — cheap and
  // avoids another table. If absent, treat as first run.
  if (!data?.error_message) return null;
  const m = /export_date=(\d{4}-\d{2}-\d{2})/.exec(data.error_message);
  return m ? m[1] : null;
}

async function writeFreshness(
  sb: SupabaseClient,
  ok: boolean,
  message: string,
  exportDate: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const encoded = ok && exportDate ? `export_date=${exportDate}` : message;
  await sb.from("data_freshness").upsert(
    {
      ico: "__GLOBAL__",
      source: "rpo_register",
      last_attempt_at: now,
      last_success_at: ok ? now : undefined,
      status: ok ? "success" : "failed",
      error_message: encoded,
      updated_at: now,
    },
    { onConflict: "ico,source" },
  );
}

interface CurrentRow {
  ico: string;
  source_record_hash: string | null;
}

async function loadCurrentHashes(sb: SupabaseClient): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  let after: string | null = null;
  for (let page = 1; page < 100_000; page++) {
    let q = sb
      .from("company_registry")
      .select("ico, source_record_hash")
      .eq("source", SOURCE)
      .eq("is_current", true)
      .order("ico", { ascending: true })
      .limit(CHUNK);
    if (after) q = q.gt("ico", after);
    const { data, error } = await q;
    if (error) throw new Error(`load current page ${page}: ${error.message}`);
    const rows = (data as CurrentRow[] | null) ?? [];
    if (rows.length === 0) break;
    for (const r of rows) map.set(r.ico, r.source_record_hash);
    after = rows[rows.length - 1]?.ico ?? null;
    if (rows.length < CHUNK) break;
  }
  return map;
}

/** Upsert one chunk of parsed RPO records into company_registry. */
async function upsertChunk(
  sb: SupabaseClient,
  chunk: RpoRawRecord[],
  currentHashes: Map<string, string | null>,
  stats: { inserted: number; updated: number; unchanged: number },
): Promise<void> {
  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const r of chunk) {
    const hash = recordHash(r);
    const prevHash = currentHashes.get(r.ico) ?? undefined;
    if (prevHash === hash) {
      stats.unchanged++;
      continue;
    }
    if (prevHash !== undefined) stats.updated++;
    else stats.inserted++;

    const addressPieces = [r.street, r.psc, r.obec].filter(Boolean);
    rows.push({
      ico: r.ico,
      source: SOURCE,
      name: r.name,
      name_normalized: normalizeCompanyName(r.name),
      legal_form: r.legalForm,
      address: addressPieces.length ? addressPieces.join(", ") : null,
      street: r.street,
      psc: r.psc,
      obec: r.obec,
      obec_normalized: normalizeText(r.obec),
      status: r.status,
      registration_date: r.establishment,
      valid_from: now,
      valid_to: null,
      is_current: true,
      first_seen_at: prevHash !== undefined ? undefined : now,
      last_seen_at: now,
      removed_at: null,
      source_record_hash: hash,
      imported_at: now,
    });
  }
  if (rows.length === 0) return;
  const { error } = await sb
    .from("company_registry")
    .upsert(rows, { onConflict: "ico,source" });
  if (error) throw new Error(`upsert chunk: ${error.message}`);
}

/** Refresh company_match_keys from a chunk of records. */
async function refreshMatchKeysChunk(
  sb: SupabaseClient,
  chunk: RpoRawRecord[],
): Promise<number> {
  const now = new Date().toISOString();
  const rows = chunk
    .map((r) => {
      const nameNorm = normalizeCompanyName(r.name);
      if (!nameNorm) return null;
      return {
        ico: r.ico,
        name_normalized: nameNorm,
        psc: r.psc,
        obec: normalizeText(r.obec),
        updated_at: now,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (rows.length === 0) return 0;
  const { error } = await sb
    .from("company_match_keys")
    .upsert(rows, { onConflict: "ico" });
  if (error) throw new Error(`match_keys chunk: ${error.message}`);
  return rows.length;
}

/** Close-removed helper (chunked, RPC-based). */
async function closeRemoved(sb: SupabaseClient, icos: string[]): Promise<number> {
  let deactivated = 0;
  for (let i = 0; i < icos.length; i += CHUNK) {
    const slice = icos.slice(i, i + CHUNK);
    const { data, error } = await sb.rpc("close_removed_registry_keys", {
      _source: SOURCE,
      _icos: slice,
    });
    if (error) throw new Error(`close_removed chunk ${i / CHUNK + 1}: ${error.message}`);
    deactivated += Number(data ?? 0);
  }
  return deactivated;
}

export async function importRpoRegister(runId: string): Promise<RpoImportResult> {
  const result: RpoImportResult = {
    status: "failed",
    errorMessage: null,
    batchKind: null,
    exportDate: null,
    recordsParsed: 0,
    recordsInserted: 0,
    recordsUpdated: 0,
    recordsUnchanged: 0,
    recordsDeactivated: 0,
    matchKeysRefreshed: 0,
  };

  const sb = await loadAdmin();
  const progress: ProgressCtx = { admin: sb, runId, source: "rpo_register" };

  try {
    await reportProgress(progress, { phase: "download", message: "Zisťujem najnovší RPO export…" });
    const prevExportDate = await latestExportDate(sb);
    const batch = await findLatestRpoBatch(prevExportDate);
    result.batchKind = batch.kind;
    result.exportDate = batch.exportDate;
    log(`batch selected kind=${batch.kind} date=${batch.exportDate} parts=${batch.files.length} prev=${prevExportDate ?? "none"}`);

    if (batch.files.length === 0) {
      log("nothing new since last run");
      await writeFreshness(sb, true, "", batch.exportDate);
      await reportProgress(progress, { phase: "done", message: "Bez zmien voči poslednému behu." });
      result.status = "unchanged";
      result.errorMessage = null;
      return result;
    }

    await reportProgress(progress, {
      phase: "download",
      message: `Sťahujem ${batch.files.length} súbor(ov) (${batch.kind}, ${batch.exportDate})…`,
    });
    const dl = await downloadRpoBatch(batch);
    if (dl.status !== "success") {
      throw new Error(dl.errorMessage ?? "Download failed");
    }

    try {
      // -------- Parse + upsert in streaming chunks --------
      await reportProgress(progress, {
        phase: "staging",
        message: `Parsujem a ukladám záznamy v dávkach po ${CHUNK}…`,
      });
      const currentHashes = await loadCurrentHashes(sb);
      log(`current registry entries: ${currentHashes.size}`);

      const seenIcos = new Set<string>();
      const upsertStats = { inserted: 0, updated: 0, unchanged: 0 };
      let buffer: RpoRawRecord[] = [];
      let totalParsed = 0;
      let chunksDone = 0;
      let matchKeysRefreshed = 0;

      const flush = async (): Promise<void> => {
        if (buffer.length === 0) return;
        await upsertChunk(sb, buffer, currentHashes, upsertStats);
        matchKeysRefreshed += await refreshMatchKeysChunk(sb, buffer);
        chunksDone++;
        // Update hashes so subsequent files with the same ico don't reprocess.
        for (const r of buffer) currentHashes.set(r.ico, recordHash(r));
        if (chunksDone % 10 === 0) {
          await reportProgress(progress, {
            phase: "staging",
            currentBatch: chunksDone,
            recordsProcessed: totalParsed,
            message: `Spracovaných ${totalParsed} záznamov (${chunksDone} dávok)`,
          });
          log(`progress parsed=${totalParsed} inserted=${upsertStats.inserted} updated=${upsertStats.updated} unchanged=${upsertStats.unchanged}`);
        }
        buffer = [];
      };

      for (let i = 0; i < dl.downloads.length; i++) {
        const file = dl.downloads[i];
        log(`streaming part ${i + 1}/${dl.downloads.length} ${file.filePath}`);
        for await (const rec of streamRpoRecords(file.filePath)) {
          if (seenIcos.has(rec.ico)) continue; // dedupe across parts
          seenIcos.add(rec.ico);
          buffer.push(rec);
          totalParsed++;
          if (buffer.length >= CHUNK) await flush();
        }
      }
      await flush();

      result.recordsParsed = totalParsed;
      result.recordsInserted = upsertStats.inserted;
      result.recordsUpdated = upsertStats.updated;
      result.recordsUnchanged = upsertStats.unchanged;
      result.matchKeysRefreshed = matchKeysRefreshed;
      log(`parse+upsert done parsed=${totalParsed} inserted=${upsertStats.inserted} updated=${upsertStats.updated} unchanged=${upsertStats.unchanged} match_keys=${matchKeysRefreshed}`);

      // -------- Sanity gate --------
      if (batch.kind === "init" && totalParsed < MIN_INIT_RECORDS) {
        throw new Error(
          `Init batch príliš malý: ${totalParsed} < ${MIN_INIT_RECORDS}. Odmietnutý.`,
        );
      }

      // -------- Close-removed (init only — dailies are deltas) --------
      if (batch.kind === "init") {
        await reportProgress(progress, {
          phase: "reconciliation",
          message: "Uzatváram odstránené záznamy…",
        });
        const removedIcos: string[] = [];
        for (const ico of currentHashes.keys()) {
          if (!seenIcos.has(ico)) removedIcos.push(ico);
        }
        log(`close-removed count=${removedIcos.length}`);
        result.recordsDeactivated = await closeRemoved(sb, removedIcos);
      }

      await writeFreshness(sb, true, "", batch.exportDate);
      await reportProgress(progress, {
        phase: "done",
        recordsProcessed: totalParsed,
        message: `Hotovo: ${upsertStats.inserted} nových, ${upsertStats.updated} zmenených, ${upsertStats.unchanged} bez zmeny.`,
      });
      result.status = "success";
      result.errorMessage = null;
      return result;
    } finally {
      // Cleanup temp files
      for (const dl2 of dl.downloads) {
        try {
          await dl2.cleanup();
        } catch (err) {
          logErr("cleanup failed", err);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "RPO import failed";
    logErr("import failed", err);
    await writeFreshness(sb, false, message, result.exportDate);
    await reportProgress(progress, { phase: "failed", message });
    result.status = "failed";
    result.errorMessage = message;
    return result;
  }
}
