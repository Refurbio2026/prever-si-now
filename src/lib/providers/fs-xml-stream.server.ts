// Streaming parser for Finančná správa OpenData XML archives.
// The files are single-XML-in-ZIP payloads with a repeating <ITEM>...</ITEM>
// structure. VAT register uncompresses to ~125 MB, so we cannot buffer the
// whole thing — we stream the ZIP through fflate, decompressed chunks into a
// small text state machine that yields one item's fields at a time.

import { createReadStream } from "node:fs";
import { Unzip, UnzipInflate } from "fflate";
import { downloadToTempFile } from "@/lib/providers/download-to-file.server";

export interface StreamSourceMeta {
  status: number;
  contentType: string;
  contentLength: number;
  lastModified: string | null;
  etag: string | null;
  bytesRead: number;
  contentHash: string;
  rootDate: string | null;
  itemCount: number;
  sampleColumnNames: string[];
  sampleItems: Array<Record<string, string>>;
}
const DECODER = new TextDecoder("utf-8");
const ITEM_OPEN = "<ITEM>";
const ITEM_CLOSE = "</ITEM>";
const TAG_RE = /<([A-Z0-9_]+)>([\s\S]*?)<\/\1>/g;
const XML_ENTITY_RE = /&(quot|amp|lt|gt|apos|#\d+);/g;

function decodeXmlEntities(s: string): string {
  return s.replace(XML_ENTITY_RE, (_, code) => {
    switch (code) {
      case "quot":
        return '"';
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "apos":
        return "'";
      default:
        if (code.startsWith("#")) {
          const n = Number(code.slice(1));
          return Number.isFinite(n) ? String.fromCharCode(n) : "";
        }
        return "";
    }
  });
}

function parseItem(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(raw)) !== null) {
    out[m[1]] = decodeXmlEntities(m[2]).trim();
  }
  return out;
}

function extractRootDate(buf: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const m = buf.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Convert a date-like string ("31052026", "31.05.2026", "2026-05-31") to ISO.
 */
export function toIsoDate(input: string | null): string | null {
  if (!input) return null;
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dot) return `${dot[3]}-${dot[2].padStart(2, "0")}-${dot[1].padStart(2, "0")}`;
  const compact = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (compact) return `${compact[3]}-${compact[2]}-${compact[1]}`;
  return null;
}

export interface StreamFsXmlOptions {
  url: string;
  xmlSuffix: string; // e.g. "ds_dsdd.xml"
  rootDateTag: string; // e.g. "DatumAktualizacieZoznamu"
  onItem?: (fields: Record<string, string>) => void | Promise<void>;
  /** Cap the number of items processed. Diagnostics uses a small cap. */
  maxItems?: number;
  /** Keep up to N sample items in the returned meta (for diagnostics). */
  sampleCount?: number;
}

/** Stream a FS OpenData ZIP-of-XML from `url`, invoking `onItem` for each
 *  `<ITEM>` block. Returns a metadata summary including the source hash. */
export async function streamFsXml(opts: StreamFsXmlOptions): Promise<StreamSourceMeta> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const res = await fetch(opts.url, {
    signal: ctrl.signal,
    headers: {
      "User-Agent": "PreverSi DataHub (+https://preversi.sk)",
      Accept: "application/zip, */*",
    },
  }).finally(() => clearTimeout(timer));

  const meta: StreamSourceMeta = {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    contentLength: Number(res.headers.get("content-length") ?? "0"),
    lastModified: res.headers.get("last-modified"),
    etag: res.headers.get("etag"),
    bytesRead: 0,
    contentHash: "",
    rootDate: null,
    itemCount: 0,
    sampleColumnNames: [],
    sampleItems: [],
  };

  if (!res.ok || !res.body) {
    meta.contentHash = createHash("sha256").update("").digest("hex");
    return meta;
  }

  const hasher: Hash = createHash("sha256");
  let textBuf = "";
  let rootDateFound = false;
  let itemsDone = 0;
  let aborted = false;
  const sampleTarget = opts.sampleCount ?? 3;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);

  // Collect XML chunks from the target file inside the ZIP.
  const xmlChunks: Uint8Array[] = [];
  let xmlFinal = false;

  unzip.onfile = (file) => {
    if (!file.name.toLowerCase().endsWith(opts.xmlSuffix.toLowerCase())) return;
    file.ondata = (err, data, final) => {
      if (err) throw err;
      if (data && data.length > 0) xmlChunks.push(data);
      if (final) xmlFinal = true;
    };
    file.start();
  };

  const flushXml = async (): Promise<void> => {
    if (xmlChunks.length === 0) return;
    // Concatenate accumulated chunks and reset.
    let total = 0;
    for (const c of xmlChunks) total += c.length;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of xmlChunks) {
      merged.set(c, off);
      off += c.length;
    }
    xmlChunks.length = 0;
    textBuf += DECODER.decode(merged, { stream: !xmlFinal });

    if (!rootDateFound) {
      const d = extractRootDate(textBuf, opts.rootDateTag);
      if (d) {
        meta.rootDate = d;
        rootDateFound = true;
      }
    }

    // Emit every complete <ITEM>...</ITEM>.
    while (true) {
      if (aborted) return;
      const open = textBuf.indexOf(ITEM_OPEN);
      if (open === -1) {
        // Retain last 1KB so a possible open tag isn't lost.
        if (textBuf.length > 1024) textBuf = textBuf.slice(-1024);
        return;
      }
      const close = textBuf.indexOf(ITEM_CLOSE, open + ITEM_OPEN.length);
      if (close === -1) {
        // Wait for more data.
        textBuf = textBuf.slice(open);
        return;
      }
      const raw = textBuf.slice(open + ITEM_OPEN.length, close);
      textBuf = textBuf.slice(close + ITEM_CLOSE.length);
      const fields = parseItem(raw);
      itemsDone++;
      if (meta.sampleItems.length < sampleTarget) {
        meta.sampleItems.push(fields);
        for (const k of Object.keys(fields)) {
          if (!meta.sampleColumnNames.includes(k)) meta.sampleColumnNames.push(k);
        }
      }
      if (opts.onItem) await opts.onItem(fields);
      if (opts.maxItems && itemsDone >= opts.maxItems) {
        aborted = true;
        return;
      }
    }
  };

  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        meta.bytesRead += value.length;
        hasher.update(value);
        unzip.push(value, false);
        await flushXml();
      }
      if (aborted) break;
    }
    if (!aborted) {
      unzip.push(new Uint8Array(0), true);
      await flushXml();
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }

  meta.contentHash = hasher.digest("hex");
  meta.itemCount = itemsDone;
  return meta;
}
