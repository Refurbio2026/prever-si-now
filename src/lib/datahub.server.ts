// Server-only worker for the DataHub bulk import queue.
// Each source runs a specific provider/import and writes an import_logs entry.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ImportSource =
  | "finstat"
  | "ruz"
  | "rpvs"
  | "crz"
  | "registry"
  | "people"
  | "history";

export const SUPPORTED_SOURCES: readonly ImportSource[] = [
  "finstat",
  "ruz",
  "rpvs",
  "crz",
  "registry",
  "people",
  "history",
] as const;

const FINSTAT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Result contract for a single source run. */
export interface SourceRunResult {
  imported: number;
  skipped: boolean;
  message?: string;
}

async function writeLog(
  ico: string,
  source: string,
  fn: () => Promise<SourceRunResult>,
): Promise<SourceRunResult> {
  const startedAt = new Date().toISOString();
  const { data: logRow } = await supabaseAdmin
    .from("import_logs")
    .insert({ ico, source, status: "running", started_at: startedAt })
    .select("id")
    .single();
  try {
    const res = await fn();
    if (logRow) {
      await supabaseAdmin
        .from("import_logs")
        .update({
          status: res.skipped ? "skipped" : "ok",
          records_count: res.imported,
          finished_at: new Date().toISOString(),
          error_message: res.message ?? null,
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

async function runFinstat(ico: string, force: boolean): Promise<SourceRunResult> {
  if (!force) {
    const { data: cached } = await supabaseAdmin
      .from("company_cache")
      .select("fetched_at")
      .eq("ico", ico)
      .maybeSingle();
    if (cached) {
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      if (age < FINSTAT_CACHE_TTL_MS) {
        return { imported: 0, skipped: true, message: "cache hit" };
      }
    }
  }
  const { finstatGetByIco, normalizeDetail, getFinstatEnvStatus } = await import(
    "./finstat.server"
  );
  if (!getFinstatEnvStatus().allSet) {
    return { imported: 0, skipped: true, message: "Finstat nie je nakonfigurované" };
  }
  const raw = await finstatGetByIco(ico);
  const bundle = normalizeDetail(raw);
  const now = new Date().toISOString();
  await supabaseAdmin.from("company_cache").upsert(
    { ico, data: bundle as unknown as never, fetched_at: now, updated_at: now },
    { onConflict: "ico" },
  );
  return { imported: 1, skipped: false };
}

async function runRuz(ico: string): Promise<SourceRunResult> {
  const { ruzStatements, ruzFinancials } = await import("./providers/ruz.provider.server");
  const [s, f] = await Promise.all([ruzStatements(ico), ruzFinancials(ico)]);
  const count = (s.data?.length ?? 0) + (f.data?.length ?? 0);
  const stateMsg = s.status.state !== "ok" ? s.status.message : undefined;
  return { imported: count, skipped: false, message: stateMsg };
}

async function runRpvs(ico: string): Promise<SourceRunResult> {
  const { rpvsPartnerBundle } = await import("./providers/rpvs.provider.server");
  const res = await rpvsPartnerBundle(ico);
  const bundle = res.data;
  const count = bundle ? (bundle.beneficialOwners?.length ?? 0) : 0;
  return {
    imported: count,
    skipped: false,
    message: res.status.state !== "ok" ? res.status.message : undefined,
  };
}

async function runCrz(ico: string): Promise<SourceRunResult> {
  const { crzContractsByIco } = await import("./providers/crz.provider.server");
  const res = await crzContractsByIco(ico);
  return {
    imported: res.data?.length ?? 0,
    skipped: false,
    message: res.status.state !== "ok" ? res.status.message : undefined,
  };
}

async function runRegistry(ico: string): Promise<SourceRunResult> {
  const { importCompanyRegistry } = await import("./imports.server");
  // importCompanyRegistry already writes an import_logs entry; call raw ORSR
  // fetch to avoid double-log. But keeping the simple approach: skip our
  // writeLog wrapper for these three and delegate to the existing importer.
  const res = await importCompanyRegistry(ico);
  return { imported: res.imported, skipped: false };
}

async function runPeople(ico: string): Promise<SourceRunResult> {
  const { importCompanyPeople } = await import("./imports.server");
  const res = await importCompanyPeople(ico);
  return { imported: res.imported, skipped: false };
}

async function runHistory(ico: string): Promise<SourceRunResult> {
  const { importCompanyHistory } = await import("./imports.server");
  const res = await importCompanyHistory(ico);
  return { imported: res.imported, skipped: false };
}

/** Run one source for one IČO. Writes import_logs (except for registry/people/history
 *  which log internally via imports.server withLog). */
export async function runSourceForIco(
  ico: string,
  source: ImportSource,
  force: boolean,
): Promise<SourceRunResult> {
  switch (source) {
    case "finstat":
      return writeLog(ico, "FINSTAT:detail", () => runFinstat(ico, force));
    case "ruz":
      return writeLog(ico, "RUZ:statements", () => runRuz(ico));
    case "rpvs":
      return writeLog(ico, "RPVS:partners", () => runRpvs(ico));
    case "crz":
      return writeLog(ico, "CRZ:contracts", () => runCrz(ico));
    case "registry":
      return runRegistry(ico);
    case "people":
      return runPeople(ico);
    case "history":
      return runHistory(ico);
  }
}

const RATE_LIMIT_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface QueueBatchResult {
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  errors: Array<{ ico: string; source: string; error: string }>;
}

/** Process up to `limit` pending queue jobs, oldest priority first. */
export async function processQueueBatch(limit: number): Promise<QueueBatchResult> {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 100);

  const { data: pending, error } = await supabaseAdmin
    .from("import_queue")
    .select("id, ico, source, priority, attempts, force_refresh")
    .eq("status", "pending")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(capped);
  if (error) throw new Error(error.message);

  const result: QueueBatchResult = {
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };
  if (!pending || pending.length === 0) return result;

  // Claim each job to running individually so concurrent workers don't
  // double-run the same row (we can't easily do CAS through the JS client).
  for (const job of pending) {
    const now = new Date().toISOString();
    const { data: claimed } = await supabaseAdmin
      .from("import_queue")
      .update({ status: "running", started_at: now, attempts: (job.attempts ?? 0) + 1 })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    result.processed += 1;

    try {
      if (!SUPPORTED_SOURCES.includes(job.source as ImportSource)) {
        throw new Error(`Nepodporovaný zdroj: ${job.source}`);
      }
      const runRes = await runSourceForIco(
        job.ico,
        job.source as ImportSource,
        job.force_refresh ?? false,
      );
      if (runRes.skipped) result.skipped += 1;
      else result.successful += 1;
      await supabaseAdmin
        .from("import_queue")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", job.id);
    } catch (err) {
      const msg = (err as Error).message ?? "Neznáma chyba";
      result.failed += 1;
      result.errors.push({ ico: job.ico, source: job.source, error: msg });
      await supabaseAdmin
        .from("import_queue")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          last_error: msg,
        })
        .eq("id", job.id);
    }

    await sleep(RATE_LIMIT_DELAY_MS);
  }

  return result;
}
