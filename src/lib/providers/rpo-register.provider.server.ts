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
import { open, stat } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { downloadToTempFile, type DownloadedFile } from "@/lib/providers/download-to-file.server";

const PART_ATTEMPTS = 3;
const PART_BACKOFF_MS = 30_000;

/** Read the first 2 bytes of a file and confirm they are the gzip magic. On
 *  mismatch, log the first 200 bytes as UTF-8 text so we can see the HTML
 *  error page / whatever body was actually saved. */
async function validateGzipFile(filePath: string, label: string): Promise<void> {
  const fh = await open(filePath, "r");
  try {
    const st = await stat(filePath);
    if (st.size < 18) {
      const buf = Buffer.alloc(Math.min(200, st.size));
      if (st.size > 0) await fh.read(buf, 0, buf.length, 0);
      throw new Error(
        `Invalid gzip ${label}: file too small (${st.size} bytes). Head: ${buf.toString("utf8").slice(0, 200)}`,
      );
    }
    const magic = Buffer.alloc(2);
    await fh.read(magic, 0, 2, 0);
    if (magic[0] !== 0x1f || magic[1] !== 0x8b) {
      const head = Buffer.alloc(200);
      await fh.read(head, 0, 200, 0);
      throw new Error(
        `Invalid gzip magic ${label}: got ${magic[0].toString(16)} ${magic[1].toString(16)}. Head bytes as text: ${head.toString("utf8").replace(/\s+/g, " ").slice(0, 200)}`,
      );
    }
  } finally {
    await fh.close();
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Download one RPO part with validation. Retries the full download (fresh
 *  temp dir each time) if the resulting file is not a valid gzip. */
async function downloadAndValidatePart(
  url: string,
  label: string,
  filename: string,
): Promise<DownloadedFile> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
    let dl: DownloadedFile | null = null;
    try {
      dl = await downloadToTempFile({
        url,
        label: `${label} (attempt ${attempt}/${PART_ATTEMPTS})`,
        filename,
        attempts: 1, // per-attempt retry lives here so validation can trigger it
      });
      await validateGzipFile(dl.filePath, label);
      return dl;
    } catch (err) {
      lastErr = err;
      console.error(
        `[datahub] RPO part validation failed attempt=${attempt}/${PART_ATTEMPTS}`,
        err instanceof Error ? err.message : err,
      );
      if (dl) {
        try {
          await dl.cleanup();
        } catch {
          /* ignore */
        }
      }
      if (attempt < PART_ATTEMPTS) await sleep(PART_BACKOFF_MS);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`RPO part failed after ${PART_ATTEMPTS} attempts`);
}

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

/** Fetch and parse an init batch manifest (_list.txt). Each non-empty line is
 *  a filename (e.g. "init_2026-07-04_001.json.gz"). Returns null if missing. */
async function fetchInitManifest(date: string): Promise<Set<string> | null> {
  // The manifest key appears as batch-init/init_YYYY-MM-DD_list.txt.
  const url = `${BUCKET_URL}/batch-init/init_${date}_list.txt`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "PreverSi DataHub" } });
    if (!res.ok) return null;
    const text = await res.text();
    const names = new Set<string>();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      // Manifest may include a path or bare filename — normalize to basename.
      const base = line.split("/").pop() ?? line;
      if (base.endsWith(".json.gz")) names.add(base);
    }
    return names.size > 0 ? names : null;
  } catch {
    return null;
  }
}

/** Find the latest available RPO batch. Preference: newest daily since last
 *  known export → latest init snapshot. Caller passes the previously-imported
 *  export date to prefer deltas.
 *
 *  For dailies we return ALL pending dailies (in chronological order) as a
 *  single multi-part "daily" batch, so a run catches up any backlog. */
export async function findLatestRpoBatch(previousExportDate: string | null): Promise<RpoBatchListing> {
  const [initItems, dailyItems] = await Promise.all([
    listBucket("batch-init/"),
    listBucket("batch-daily/"),
  ]);

  // Group init files by date — ONLY *.json.gz data parts. Explicitly exclude
  // manifests (_list.txt) and any other non-gz entries in the bucket.
  const initByDate = new Map<string, string[]>();
  for (const it of initItems) {
    if (!it.key.endsWith(".json.gz")) continue; // skips _list.txt, checksums, etc.
    const m = it.key.match(/^batch-init\/init_(\d{4}-\d{2}-\d{2})_\d+\.json\.gz$/);
    if (!m) continue;
    if (!initByDate.has(m[1])) initByDate.set(m[1], []);
    initByDate.get(m[1])!.push(`${BUCKET_URL}/${it.key}`);
  }
  const latestInitDate = [...initByDate.keys()].sort().pop() ?? null;

  // Group dailies by date (single file per date).
  const dailyByDate = new Map<string, string>();
  for (const it of dailyItems) {
    if (!it.key.endsWith(".json.gz")) continue;
    const m = it.key.match(/^batch-daily\/actual_(\d{4}-\d{2}-\d{2})\.json\.gz$/);
    if (m) dailyByDate.set(m[1], `${BUCKET_URL}/${it.key}`);
  }

  async function initBatch(date: string): Promise<RpoBatchListing> {
    const files = (initByDate.get(date) ?? []).slice().sort();
    // Cross-check against the manifest when available: warn if the bucket is
    // missing parts the manifest promises. We keep the file set derived from
    // the bucket listing (source of truth for what actually exists to
    // download) but this surfaces missing-part gaps in the logs.
    const manifest = await fetchInitManifest(date);
    if (manifest) {
      const present = new Set(files.map((u) => u.split("/").pop() ?? ""));
      const missing = [...manifest].filter((n) => !present.has(n));
      const extra = [...present].filter((n) => !manifest.has(n));
      if (missing.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[datahub] RPO manifest ${date}: bucket missing ${missing.length} listed parts: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`,
        );
      }
      if (extra.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[datahub] RPO manifest ${date}: bucket has ${extra.length} extra parts not in manifest: ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? "…" : ""}`,
        );
      }
    } else {
      log(`no manifest _list.txt for init ${date} (skipping cross-check)`);
    }
    return { kind: "init", exportDate: date, files };
  }

  // Decision:
  // - No previous import: always seed from latest init.
  // - Previous import present AND latest init is newer than what we have: take the init.
  // - Otherwise: take ALL dailies strictly after previousExportDate.
  if (!previousExportDate) {
    if (!latestInitDate) throw new Error("No RPO init batch available.");
    return initBatch(latestInitDate);
  }
  if (latestInitDate && latestInitDate > previousExportDate) {
    return initBatch(latestInitDate);
  }
  const newerDailies = [...dailyByDate.entries()]
    .filter(([date]) => date > previousExportDate)
    .sort(([a], [b]) => a.localeCompare(b));
  if (newerDailies.length === 0) {
    // Nothing new — return the previous date as a signal (files empty).
    return { kind: "daily", exportDate: previousExportDate, files: [] };
  }
  // Return ALL pending dailies in order; exportDate is the newest so the
  // checkpoint moves forward once they've all been applied.
  const files = newerDailies.map(([, url]) => url);
  const newestDate = newerDailies[newerDailies.length - 1][0];
  log(`daily catch-up: ${files.length} file(s) from ${newerDailies[0][0]} to ${newestDate}`);
  return { kind: "daily", exportDate: newestDate, files };
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


/** Download+validate a single RPO part. Caller MUST call `cleanup()` on the
 *  returned file when done streaming. */
export async function downloadRpoPart(
  batch: RpoBatchListing,
  partIndex: number, // 1-based
): Promise<DownloadedFile> {
  const url = batch.files[partIndex - 1];
  const filename = `rpo-${batch.exportDate}-${String(partIndex).padStart(3, "0")}.json.gz`;
  const label = `RPO ${batch.kind} ${partIndex}/${batch.files.length}`;
  log(`downloading ${label}: ${url.split("/").pop()}`);
  return downloadAndValidatePart(url, label, filename);
}

