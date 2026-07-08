// Finstat PREMIUM API — isolated authentication layer.
//
// SINGLE SOURCE OF TRUTH for anything related to how requests are signed
// and addressed against the Finstat API. The rest of the application must
// go through `signedFinstatRequest` (or the smaller building blocks it
// exposes) and must NEVER read FINSTAT_* env vars, compute hashes, build
// URLs, or serialize params on its own.
//
// Server-only. Do not import from client-reachable modules.

import { createHash } from "crypto";

export const DEFAULT_FINSTAT_BASE_URL = "https://www.finstat.sk/api";
const FINSTAT_HASH_SALT = "SomeSalt";

export interface FinstatCredentials {
  apiKey: string;
  privateKey: string;
  baseUrl: string;
}

export interface FinstatEnvStatus {
  FINSTAT_API_KEY: boolean;
  FINSTAT_PRIVATE_KEY: boolean;
  FINSTAT_BASE_URL: boolean;
  allSet: boolean;
  baseUrl: string;
}

export class FinstatAuthError extends Error {
  code: "missing_credentials";
  constructor(message: string) {
    super(message);
    this.name = "FinstatAuthError";
    this.code = "missing_credentials";
  }
}

/** Report presence (never values) of Finstat env variables. */
export function getFinstatEnvStatus(): FinstatEnvStatus {
  const apiKey = !!process.env.FINSTAT_API_KEY?.trim();
  const privateKey = !!process.env.FINSTAT_PRIVATE_KEY?.trim();
  const baseUrl = !!process.env.FINSTAT_BASE_URL?.trim();
  return {
    FINSTAT_API_KEY: apiKey,
    FINSTAT_PRIVATE_KEY: privateKey,
    FINSTAT_BASE_URL: baseUrl,
    allSet: apiKey && privateKey,
    baseUrl: process.env.FINSTAT_BASE_URL?.trim() || DEFAULT_FINSTAT_BASE_URL,
  };
}

/** Load credentials or throw. Never logs the values. */
export function getFinstatCredentials(): FinstatCredentials {
  const apiKey = process.env.FINSTAT_API_KEY?.trim();
  const privateKey = process.env.FINSTAT_PRIVATE_KEY?.trim();
  if (!apiKey || !privateKey) {
    throw new FinstatAuthError(
      "Finstat API credentials are not configured on the server.",
    );
  }
  return {
    apiKey,
    privateKey,
    baseUrl: process.env.FINSTAT_BASE_URL?.trim() || DEFAULT_FINSTAT_BASE_URL,
  };
}

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "*****";
  return `${value.slice(0, 2)}*****${value.slice(-2)}`;
}

/** Build the exact hash base string required by Finstat PREMIUM /api/detail. */
export function buildFinstatHashBase(ico: string): string {
  const { apiKey, privateKey } = getFinstatCredentials();
  return `${FINSTAT_HASH_SALT}+${apiKey}+${privateKey}++${ico}+ended`;
}

/** Masked hash base for diagnostics. Never exposes full keys. */
export function buildMaskedFinstatHashBase(ico: string): string {
  const { apiKey, privateKey } = getFinstatCredentials();
  return `${FINSTAT_HASH_SALT}+${maskSecret(apiKey)}+${maskSecret(privateKey)}++${ico}+ended`;
}

/** Request signing — SHA256 of UTF-8 hash base, lowercase hex. */
export function computeFinstatHash(ico: string): string {
  const base = buildFinstatHashBase(ico);
  return createHash("sha256")
    .update(base, "utf8")
    .digest("hex")
    .toLowerCase();
}

/** Build the fully-qualified endpoint URL for a Finstat API path. */
export function buildFinstatEndpoint(path: string): string {
  const { baseUrl } = getFinstatCredentials();
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

/** Serialize query parameters after signing. Never use this before hashing. */
export function serializeFinstatParams(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export interface SignedFinstatRequest {
  endpoint: string;
  method: "GET";
  headers: Record<string, string>;
  hashBase: string;
  hashBaseMasked: string;
  hash: string;
  finalUrl: string;
  finalUrlMasked: string;
}

/**
 * Build a signed, ready-to-fetch Finstat request. Callers do not add the
 * hash themselves — they pass the value that should be signed (`hashInput`)
 * and any additional parameters. This keeps signing decisions in one place.
 */
export function buildSignedFinstatRequest(
  path: string,
  params: Record<string, string>,
  hashInput: string,
): SignedFinstatRequest {
  const endpoint = buildFinstatEndpoint(path);
  const { apiKey } = getFinstatCredentials();
  const hash = computeFinstatHash(hashInput);
  const queryParams = {
    ico: params.ico ?? params.Ico ?? hashInput,
    apikey: apiKey,
    hash,
    json: "true",
  };
  const finalUrl = `${endpoint}?${serializeFinstatParams(queryParams)}`;
  const finalUrlMasked = `${endpoint}?${serializeFinstatParams({
    ...queryParams,
    apikey: maskSecret(apiKey),
  })}`;
  return {
    endpoint,
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    hashBase: buildFinstatHashBase(hashInput),
    hashBaseMasked: buildMaskedFinstatHashBase(hashInput),
    hash,
    finalUrl,
    finalUrlMasked,
  };
}
