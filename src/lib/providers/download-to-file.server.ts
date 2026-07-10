// Download a remote URL to a temp file with retries + progress logging.
// Used by DataHub importers so that slow DB work (staging cleanup,
// reconciliation) never blocks a live HTTP stream — the FS server closes
// idle TLS connections after ~30 s, causing "terminated" errors mid-parse.
// Downloading fully to disk first decouples network from DB.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface DownloadedFile {
  filePath: string;
  cleanup: () => Promise<void>;
  status: number;
  contentType: string;
  contentLength: number;
  lastModified: string | null;
  etag: string | null;
  bytesRead: number;
  contentHash: string;
}

export interface DownloadOptions {
  url: string;
  /** Short label for log lines, e.g. "VAT", "SP", "tax_debtors". */
  label: string;
  /** Filename inside the temp dir, e.g. "vat.zip". */
  filename: string;
  /** Number of attempts before giving up. Default 3. */
  attempts?: number;
  /** Backoff in ms between attempts. Default 30_000. */
  backoffMs?: number;
  /** Per-attempt fetch timeout in ms. Default 300_000 (5 min). */
  fetchTimeoutMs?: number;
  /** Log a line every N bytes read. Default 5 MB. */
  progressBytes?: number;
}

function log(label: string, msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[datahub] ${label} download ${msg}`);
}

function logError(label: string, msg: string, err?: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    `[datahub] ${label} download ${msg}`,
    err instanceof Error ? (err.stack ?? err.message) : (err ?? ""),
  );
}

async function attemptDownload(
  opts: Required<Omit<DownloadOptions, "attempts" | "backoffMs">>,
  attempt: number,
): Promise<DownloadedFile> {
  const { url, label, filename, fetchTimeoutMs, progressBytes } = opts;
  const dir = await mkdtemp(join(tmpdir(), "preversi-dl-"));
  const filePath = join(dir, filename);
  const cleanup = async (): Promise<void> => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      logError(label, `cleanup failed for ${dir}`, err);
    }
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), fetchTimeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "PreverSi DataHub (+https://preversi.sk)",
        Accept: "application/zip, */*",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    await cleanup();
    throw err;
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    await cleanup();
    throw new Error(`HTTP ${res.status} pri sťahovaní ${label} (pokus ${attempt}).`);
  }

  const contentLength = Number(res.headers.get("content-length") ?? "0");
  log(
    label,
    `attempt ${attempt} started status=${res.status} contentLength=${contentLength}`,
  );

  const hasher = createHash("sha256");
  const out = createWriteStream(filePath);
  let bytesRead = 0;
  let nextProgress = progressBytes;
  const reader = res.body.getReader();

  const writeChunk = (chunk: Uint8Array): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!out.write(chunk)) {
        out.once("drain", () => resolve());
        out.once("error", reject);
      } else {
        resolve();
      }
    });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        hasher.update(value);
        bytesRead += value.length;
        await writeChunk(value);
        if (bytesRead >= nextProgress) {
          log(label, `progress ${(bytesRead / (1024 * 1024)).toFixed(1)} MB`);
          nextProgress += progressBytes;
        }
      }
    }
  } catch (err) {
    clearTimeout(timer);
    try {
      out.destroy();
    } catch {
      /* ignore */
    }
    await cleanup();
    throw err;
  }

  clearTimeout(timer);
  await new Promise<void>((resolve, reject) => {
    out.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });

  if (contentLength > 0 && bytesRead !== contentLength) {
    await cleanup();
    throw new Error(
      `Nekompletné sťahovanie ${label}: content-length=${contentLength} bytesRead=${bytesRead}`,
    );
  }

  const contentHash = hasher.digest("hex");
  log(
    label,
    `attempt ${attempt} done bytes=${bytesRead} hash=${contentHash.slice(0, 12)}`,
  );

  return {
    filePath,
    cleanup,
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    contentLength,
    lastModified: res.headers.get("last-modified"),
    etag: res.headers.get("etag"),
    bytesRead,
    contentHash,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Download `url` fully to a temp file with retry + backoff. Caller MUST
 *  call the returned `cleanup()` in a finally block. */
export async function downloadToTempFile(opts: DownloadOptions): Promise<DownloadedFile> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const backoffMs = Math.max(0, opts.backoffMs ?? 30_000);
  const filled = {
    url: opts.url,
    label: opts.label,
    filename: opts.filename,
    fetchTimeoutMs: opts.fetchTimeoutMs ?? 300_000,
    progressBytes: opts.progressBytes ?? 5 * 1024 * 1024,
  };
  let lastErr: unknown = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await attemptDownload(filled, i);
    } catch (err) {
      lastErr = err;
      logError(opts.label, `attempt ${i}/${attempts} failed`, err);
      if (i < attempts) await sleep(backoffMs);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Sťahovanie ${opts.label} zlyhalo po ${attempts} pokusoch.`);
}
