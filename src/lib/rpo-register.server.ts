// RPO register orchestrator — download the latest RPO bulk export part-by-
// part, upsert into `company_registry` (source='RPO'), refresh
// `company_match_keys` in chunks, close entries that disappeared, and
// checkpoint each successfully processed part so a failure mid-import can be
// resumed on the next run without re-processing the whole 2 GB dataset.
//
// Checkpoint format (stashed in data_freshness.error_message keyed by
// __GLOBAL__ / rpo_register):
//   export_date=YYYY-MM-DD;parts_done=1,2,3[;error=<msg>]
// On full success we simplify to:
//   export_date=YYYY-MM-DD;parts_done=all
//
// Runs in Node with no CPU/memory/time limits. Everything is chunked at 1000
// rows so individual statements stay under statement_timeout. Progress is
// written to datahub_import_progress after every phase so the admin UI shows
// live status.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { reportProgress, type ProgressCtx } from "@/lib/import-progress.server";
import {
  downloadRpoPart,
  findLatestRpoBatch,
  streamRpoRecords,
  type RpoBatchListing,
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
  partsProcessed: number;
  partsSkipped: number;
  resumed: boolean;
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

// -------------------- Freshness / checkpoint I/O --------------------

interface Checkpoint {
  exportDate: string | null;
  partsDone: Set<number>; // 1-based
  allDone: boolean;
}

function parseCheckpoint(message: string | null | undefined): Checkpoint {
  if (!message) return { exportDate: null, partsDone: new Set(), allDone: false };
  const dateM = /export_date=(\d{4}-\d{2}-\d{2})/.exec(message);
  const partsM = /parts_done=([\w,]+)/.exec(message);
  const partsDone = new Set<number>();
  let allDone = false;
  if (partsM) {
    if (partsM[1] === "all") allDone = true;
    else {
      for (const p of partsM[1].split(",")) {
        const n = Number(p);
        if (Number.isFinite(n) && n > 0) partsDone.add(n);
      }
    }
  }
  return { exportDate: dateM ? dateM[1] : null, partsDone, allDone };
}

function serializeCheckpoint(cp: Checkpoint, error?: string | null): string {
  const bits: string[] = [];
  if (cp.exportDate) bits.push(`export_date=${cp.exportDate}`);
  if (cp.allDone) bits.push("parts_done=all");
  else if (cp.partsDone.size > 0) {
    const arr = [...cp.partsDone].sort((a, b) => a - b);
    bits.push(`parts_done=${arr.join(",")}`);
  }
  if (error) bits.push(`error=${error.replace(/;/g, ",").slice(0, 400)}`);
  return bits.join(";");
}

async function loadCheckpoint(sb: SupabaseClient): Promise<Checkpoint> {
  const { data } = await sb
    .from("data_freshness")
    .select("error_message")
    .eq("ico", "__GLOBAL__")
    .eq("source", "rpo_register")
    .maybeSingle<{ error_message: string | null }>();
  return parseCheckpoint(data?.error_message ?? null);
}

async function writeCheckpoint(
  sb: SupabaseClient,
  cp: Checkpoint,
  status: "success" | "failed" | "in_progress",
  error?: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await sb.from("data_freshness").upsert(
    {
      ico: "__GLOBAL__",
      source: "rpo_register",
      last_attempt_at: now,
      last_success_at: status === "success" ? now : undefined,
      status: status === "success" ? "success" : status === "failed" ? "failed" : "running",
      error_message: serializeCheckpoint(cp, error),
      updated_at: now,
    },
    { onConflict: "ico,source" },
  );
}

// -------------------- Registry helpers --------------------

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

// -------------------- Per-part processor --------------------

interface PartStats {
  inserted: number;
  updated: number;
  unchanged: number;
}

async function processPart(
  sb: SupabaseClient,
  batch: RpoBatchListing,
  partIndex: number,
  currentHashes: Map<string, string | null>,
  seenIcos: Set<string>,
  progress: ProgressCtx,
  runningTotal: { parsed: number; matchKeys: number },
): Promise<PartStats> {
  const dl = await downloadRpoPart(batch, partIndex);
  const stats: PartStats = { inserted: 0, updated: 0, unchanged: 0 };
  try {
    let buffer: RpoRawRecord[] = [];
    let chunksDone = 0;

    const flush = async (): Promise<void> => {
      if (buffer.length === 0) return;
      await upsertChunk(sb, buffer, currentHashes, stats);
      runningTotal.matchKeys += await refreshMatchKeysChunk(sb, buffer);
      chunksDone++;
      for (const r of buffer) currentHashes.set(r.ico, recordHash(r));
      if (chunksDone % 10 === 0) {
        await reportProgress(progress, {
          phase: "staging",
          currentBatch: partIndex,
          totalBatches: batch.files.length,
          recordsProcessed: runningTotal.parsed,
          message: `Časť ${partIndex}/${batch.files.length}: ${runningTotal.parsed} záznamov`,
        });
      }
      buffer = [];
    };

    for await (const rec of streamRpoRecords(dl.filePath)) {
      if (seenIcos.has(rec.ico)) continue;
      seenIcos.add(rec.ico);
      buffer.push(rec);
      runningTotal.parsed++;
      if (buffer.length >= CHUNK) await flush();
    }
    await flush();
    log(`part ${partIndex}/${batch.files.length} done ins=${stats.inserted} upd=${stats.updated} unc=${stats.unchanged}`);
    return stats;
  } finally {
    try {
      await dl.cleanup();
    } catch (err) {
      logErr("part cleanup failed", err);
    }
  }
}

// -------------------- Main orchestrator --------------------

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
    partsProcessed: 0,
    partsSkipped: 0,
    resumed: false,
  };

  const sb = await loadAdmin();
  const progress: ProgressCtx = { admin: sb, runId, source: "rpo_register" };
  const checkpoint = await loadCheckpoint(sb);

  try {
    await reportProgress(progress, { phase: "download", message: "Zisťujem najnovší RPO export…" });
    // If we crashed mid-init, prefer resuming that same exportDate rather than
    // rolling forward — findLatestRpoBatch is told about it via the "previous"
    // arg so a newer init won't be picked up until this one finishes.
    const prevExportDate = checkpoint.exportDate;
    const batch = await findLatestRpoBatch(prevExportDate);
    result.batchKind = batch.kind;
    result.exportDate = batch.exportDate;
    log(`batch selected kind=${batch.kind} date=${batch.exportDate} parts=${batch.files.length} prev=${prevExportDate ?? "none"}`);

    if (batch.files.length === 0) {
      log("nothing new since last run");
      // Keep prior checkpoint intact (esp. parts_done=all).
      await writeCheckpoint(
        sb,
        { exportDate: batch.exportDate, partsDone: checkpoint.partsDone, allDone: checkpoint.allDone || checkpoint.partsDone.size === 0 },
        "success",
      );
      await reportProgress(progress, { phase: "done", message: "Bez zmien voči poslednému behu." });
      result.status = "unchanged";
      return result;
    }

    // Resume detection: only meaningful for init batches with a matching date.
    const isResume =
      batch.kind === "init" &&
      checkpoint.exportDate === batch.exportDate &&
      !checkpoint.allDone &&
      checkpoint.partsDone.size > 0;
    result.resumed = isResume;
    const partsDone = new Set<number>(isResume ? checkpoint.partsDone : []);
    if (isResume) {
      log(`resuming init date=${batch.exportDate} completed=${[...partsDone].sort((a,b)=>a-b).join(",")}`);
    }

    await reportProgress(progress, {
      phase: "staging",
      message: isResume
        ? `Pokračujem v behu (${partsDone.size}/${batch.files.length} častí už hotových)…`
        : `Sťahujem a spracúvam ${batch.files.length} súbor(ov) (${batch.kind}, ${batch.exportDate})…`,
    });

    const currentHashes = await loadCurrentHashes(sb);
    log(`current registry entries: ${currentHashes.size}`);

    const seenIcos = new Set<string>();
    const runningTotal = { parsed: 0, matchKeys: 0 };
    const totalStats = { inserted: 0, updated: 0, unchanged: 0 };

    for (let partIndex = 1; partIndex <= batch.files.length; partIndex++) {
      if (partsDone.has(partIndex)) {
        result.partsSkipped++;
        log(`skip part ${partIndex}/${batch.files.length} (already done)`);
        continue;
      }
      const partStats = await processPart(
        sb,
        batch,
        partIndex,
        currentHashes,
        seenIcos,
        progress,
        runningTotal,
      );
      totalStats.inserted += partStats.inserted;
      totalStats.updated += partStats.updated;
      totalStats.unchanged += partStats.unchanged;
      partsDone.add(partIndex);
      result.partsProcessed++;

      // Checkpoint after every part so a crash resumes here.
      await writeCheckpoint(
        sb,
        { exportDate: batch.exportDate, partsDone, allDone: false },
        "in_progress",
      );
    }

    result.recordsParsed = runningTotal.parsed;
    result.matchKeysRefreshed = runningTotal.matchKeys;
    result.recordsInserted = totalStats.inserted;
    result.recordsUpdated = totalStats.updated;
    result.recordsUnchanged = totalStats.unchanged;

    // Sanity gate — only enforce on fully fresh init (a resume may parse fewer
    // records this run since earlier parts were already applied).
    if (batch.kind === "init" && !isResume && runningTotal.parsed < MIN_INIT_RECORDS) {
      throw new Error(
        `Init batch príliš malý: ${runningTotal.parsed} < ${MIN_INIT_RECORDS}. Odmietnutý.`,
      );
    }

    // Close-removed: only safe on a fully-fresh init where seenIcos represents
    // the ENTIRE dataset. On a resumed init, earlier parts' IČOs aren't in
    // seenIcos, so we'd deactivate real entities. Skip and warn.
    if (batch.kind === "init") {
      if (isResume) {
        log("close-removed skipped: resumed init cannot reconstruct full seen set");
      } else {
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
    }

    await writeCheckpoint(
      sb,
      { exportDate: batch.exportDate, partsDone, allDone: true },
      "success",
    );
    await reportProgress(progress, {
      phase: "done",
      recordsProcessed: runningTotal.parsed,
      message: `Hotovo: ${totalStats.inserted} nových, ${totalStats.updated} zmenených, ${totalStats.unchanged} bez zmeny${isResume ? ` (obnovené, ${result.partsSkipped} častí preskočených)` : ""}.`,
    });
    result.status = "success";
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "RPO import failed";
    logErr("import failed", err);
    // PRESERVE checkpoint so the next run resumes from the first unfinished
    // part instead of restarting from scratch.
    const preserved: Checkpoint = {
      exportDate: result.exportDate ?? checkpoint.exportDate,
      partsDone: new Set(checkpoint.partsDone),
      allDone: false,
    };
    // Merge in parts completed during this run (tracked via result.partsProcessed
    // requires re-derivation; easier: reload from write path — but we only add
    // to partsDone inside the loop via writeCheckpoint calls, so the DB row
    // already reflects them. Just make sure we don't clobber it with a stale
    // in-memory copy.)
    try {
      const latest = await loadCheckpoint(sb);
      if (latest.partsDone.size > preserved.partsDone.size) {
        preserved.partsDone = latest.partsDone;
        preserved.exportDate = latest.exportDate ?? preserved.exportDate;
      }
    } catch {
      /* ignore */
    }
    await writeCheckpoint(sb, preserved, "failed", message);
    await reportProgress(progress, { phase: "failed", message });
    result.status = "failed";
    result.errorMessage = message;
    return result;
  }
}
