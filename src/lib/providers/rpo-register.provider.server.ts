// RPO (Register právnických osôb) global importer — provider layer.
// Public bulk export mirrored at:
//   https://frkqbrydxwdp.compat.objectstorage.eu-frankfurt-1.oraclecloud.com/susr-rpo/
// - batch-init/init_YYYY-MM-DD_NNN.json.gz  (monthly full snapshot, ~22 files)
// - batch-daily/actual_YYYY-MM-DD.json.gz   (daily delta)
//
// Each file is a single JSON object of shape:
//   { "exportDate": "2026-06-06", "results": [ {record}, {record}, ... ] }
// Records are printed one per line separated by ",\n", so we can decompress
// with node:zlib and parse line-by-line — cheap and streaming-friendly.
//
// This module lists the bucket, picks the latest init batch (or a specific
// daily), downloads each part to /tmp using the shared download-to-file
// helper (retry + hash + progress), then yields parsed records via a callback.

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { downloadToTempFile, type DownloadedFile } from "@/lib/providers/download-to-file.server";

const BUCKET_URL =
  "https://frkqbrydxwdp.compat.objectstorage.eu-frankfurt-1.oraclecloud.com/susr-rpo";

export interface RpoRawRecord {
  ico: string;
  name: string | null;
  legalForm: string | null;
  street: string | null;
  psc: string | null;
  obec: string | null;
  status: "active" | "dissolved";
  establishment: string | null;
  termination: string | null;
}

export interface RpoBatchListing {
  kind: "init" | "daily";
  exportDate: string; // YYYY-MM-DD
  files: string[]; // full URLs
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

async function listBucket(prefix: string): Promise<Array<{ key: string; size: number }>> {
  const url = `${BUCKET_URL}/?prefix=${encodeURIComponent(prefix)}&max-keys=2000`;
  const res = await fetch(url, { headers: { "User-Agent": "PreverSi DataHub" } });
  if (!res.ok) throw new Error(`list ${prefix}: HTTP ${res.status}`);
  const xml = await res.text();
  const out: Array<{ key: string; size: number }> = [];
  const re = /<Contents>\s*<Key>([^<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push({ key: m[1], size: Number(m[2]) });
  return out;
}

/** Find the latest available RPO batch. Preference: newest daily since last
 *  known export → latest init snapshot. Caller passes the previously-imported
 *  export date to prefer deltas. */
export async function findLatestRpoBatch(previousExportDate: string | null): Promise<RpoBatchListing> {
  const [initItems, dailyItems] = await Promise.all([
    listBucket("batch-init/"),
    listBucket("batch-daily/"),
  ]);

  // Group init files by date.
  const initByDate = new Map<string, string[]>();
  for (const it of initItems) {
    const m = it.key.match(/^batch-init\/init_(\d{4}-\d{2}-\d{2})_/);
    if (!m) continue;
    if (!initByDate.has(m[1])) initByDate.set(m[1], []);
    initByDate.get(m[1])!.push(`${BUCKET_URL}/${it.key}`);
  }
  const latestInitDate = [...initByDate.keys()].sort().pop() ?? null;

  // Group dailies by date (single file per date).
  const dailyByDate = new Map<string, string>();
  for (const it of dailyItems) {
    const m = it.key.match(/^batch-daily\/actual_(\d{4}-\d{2}-\d{2})\.json\.gz$/);
    if (m) dailyByDate.set(m[1], `${BUCKET_URL}/${it.key}`);
  }

  // Decision:
  // - No previous import: always seed from latest init.
  // - Previous import present AND latest init is newer than what we have: take the init.
  // - Otherwise: take the newest daily strictly after previousExportDate.
  if (!previousExportDate) {
    if (!latestInitDate) throw new Error("No RPO init batch available.");
    return {
      kind: "init",
      exportDate: latestInitDate,
      files: (initByDate.get(latestInitDate) ?? []).sort(),
    };
  }
  if (latestInitDate && latestInitDate > previousExportDate) {
    return {
      kind: "init",
      exportDate: latestInitDate,
      files: (initByDate.get(latestInitDate) ?? []).sort(),
    };
  }
  const newerDailies = [...dailyByDate.entries()]
    .filter(([date]) => date > previousExportDate)
    .sort(([a], [b]) => a.localeCompare(b));
  if (newerDailies.length === 0) {
    // Nothing new — return the previous date as a signal (files empty).
    return { kind: "daily", exportDate: previousExportDate, files: [] };
  }
  // Return the newest daily (caller will apply it).
  const [date, url] = newerDailies[newerDailies.length - 1];
  return { kind: "daily", exportDate: date, files: [url] };
}

// -------------------- Record parsing --------------------

interface RawRpoJson {
  id?: number;
  identifiers?: Array<{ value?: string; validFrom?: string; validTo?: string | null }>;
  fullNames?: Array<{ value?: string; validFrom?: string; validTo?: string | null }>;
  addresses?: Array<{
    validFrom?: string;
    validTo?: string | null;
    street?: string;
    buildingNumber?: string | number;
    postalCodes?: string[];
    municipality?: { value?: string };
  }>;
  legalForms?: Array<{
    value?: { value?: string };
    validFrom?: string;
    validTo?: string | null;
  }>;
  establishment?: string | null;
  termination?: string | null;
}

/** Pick the "current" element of a validFrom/validTo list. Prefers items where
 *  validTo is null/empty (still valid). Falls back to the most recent one. */
function pickCurrent<T extends { validFrom?: string; validTo?: string | null }>(
  list: T[] | undefined,
): T | null {
  if (!list || list.length === 0) return null;
  const open = list.filter((x) => x.validTo == null || x.validTo === "");
  if (open.length > 0) {
    return open.sort((a, b) => (b.validFrom ?? "").localeCompare(a.validFrom ?? ""))[0];
  }
  return list.slice().sort((a, b) => (b.validTo ?? "").localeCompare(a.validTo ?? ""))[0];
}

function normalizeIco(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 8) return null;
  return digits.padStart(8, "0");
}

export function parseRpoRecord(rec: RawRpoJson): RpoRawRecord | null {
  const idCurrent = pickCurrent(rec.identifiers);
  const ico = normalizeIco(idCurrent?.value ?? null);
  if (!ico) return null;
  const nameCurrent = pickCurrent(rec.fullNames);
  const addrCurrent = pickCurrent(rec.addresses);
  const legalCurrent = pickCurrent(rec.legalForms);

  const streetParts: string[] = [];
  if (addrCurrent?.street) streetParts.push(addrCurrent.street);
  if (addrCurrent?.buildingNumber != null && String(addrCurrent.buildingNumber) !== "0") {
    streetParts.push(String(addrCurrent.buildingNumber));
  }
  const street = streetParts.length > 0 ? streetParts.join(" ") : null;
  const psc = addrCurrent?.postalCodes?.[0]?.replace(/\s/g, "") ?? null;
  const obec = addrCurrent?.municipality?.value ?? null;
  const legalForm = legalCurrent?.value?.value ?? null;
  const termination = rec.termination ?? null;
  const status: "active" | "dissolved" = termination ? "dissolved" : "active";

  return {
    ico,
    name: nameCurrent?.value ?? null,
    legalForm,
    street,
    psc,
    obec,
    status,
    establishment: rec.establishment ?? null,
    termination,
  };
}

// -------------------- Streaming iterator --------------------

/** Stream records out of a downloaded .json.gz file. The RPO export prints
 *  one record per line (after the header line), so a readline-based parser
 *  handles arbitrarily large files with bounded memory. */
export async function* streamRpoRecords(filePath: string): AsyncGenerator<RpoRawRecord> {
  const gunzip = createGunzip();
  const stream = createReadStream(filePath).pipe(gunzip);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const rawLine of rl) {
    let line = rawLine.trim();
    if (!line) continue;
    // Strip leading comma (records after the first).
    if (line.startsWith(",")) line = line.slice(1).trimStart();
    // Skip header/footer wrappers.
    if (!line.startsWith("{")) continue;
    // Trailing comma / closing bracket cleanup.
    if (line.endsWith(",")) line = line.slice(0, -1);
    if (line.endsWith("]}")) line = line.slice(0, -2);
    if (line.endsWith("]")) line = line.slice(0, -1);
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      const rec = JSON.parse(line) as RawRpoJson;
      const parsed = parseRpoRecord(rec);
      if (parsed) yield parsed;
    } catch {
      // Corrupt line — skip. Full-file parse would be worse.
    }
  }
}

export interface RpoDownloadOutcome {
  status: "success" | "unchanged" | "failed";
  batch: RpoBatchListing;
  downloads: DownloadedFile[];
  contentHash: string; // combined
  errorMessage: string | null;
}

/** Download every part of a batch to /tmp. Caller must call cleanup() on each
 *  DownloadedFile in a finally block. */
export async function downloadRpoBatch(batch: RpoBatchListing): Promise<RpoDownloadOutcome> {
  if (batch.files.length === 0) {
    return {
      status: "unchanged",
      batch,
      downloads: [],
      contentHash: "",
      errorMessage: null,
    };
  }
  const downloads: DownloadedFile[] = [];
  const hashes: string[] = [];
  try {
    let i = 0;
    for (const url of batch.files) {
      i++;
      log(`downloading part ${i}/${batch.files.length}: ${url.split("/").pop()}`);
      const dl = await downloadToTempFile({
        url,
        label: `RPO ${batch.kind} ${i}/${batch.files.length}`,
        filename: `rpo-${batch.exportDate}-${String(i).padStart(3, "0")}.json.gz`,
      });
      downloads.push(dl);
      hashes.push(dl.contentHash);
    }
    // Combined content hash = concatenation of per-part hashes.
    const combined = hashes.join("");
    return {
      status: "success",
      batch,
      downloads,
      contentHash: combined,
      errorMessage: null,
    };
  } catch (err) {
    // Best-effort cleanup of anything downloaded so far.
    for (const dl of downloads) {
      try {
        await dl.cleanup();
      } catch {
        /* ignore */
      }
    }
    logErr("download failed", err);
    return {
      status: "failed",
      batch,
      downloads: [],
      contentHash: "",
      errorMessage: err instanceof Error ? err.message : "download failed",
    };
  }
}
