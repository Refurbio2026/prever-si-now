// Finstat PREMIUM API — isolated authentication layer.
//
// SINGLE SOURCE OF TRUTH for anything related to how requests are signed
// and addressed against the Finstat API. The rest of the application must
// go through `signedFinstatRequest` (or the smaller building blocks it
// exposes) and must NEVER read FINSTAT_* env vars, compute hashes, build
// URLs, or serialize params on its own.
//
// The current hash + request shape below is a PLACEHOLDER kept from the
// previous integration and is known to fail with:
//     HTTP 403 — "Invalid verification hash."
// It MUST be replaced with the algorithm described in the official
// Finstat PREMIUM API documentation. When that happens, only this file
// changes — callers stay the same.
//
// Server-only. Do not import from client-reachable modules.

import { createHash } from "crypto";

export const DEFAULT_FINSTAT_BASE_URL = "https://www.finstat.sk/api";
export const FINSTAT_STATION_ID = "preversi-sk";
export const FINSTAT_STATION_NAME = "PreverSi.sk";

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
  const apiKey = !!process.env.FINSTAT_API_KEY;
  const privateKey = !!process.env.FINSTAT_PRIVATE_KEY;
  const baseUrl = !!process.env.FINSTAT_BASE_URL;
  return {
    FINSTAT_API_KEY: apiKey,
    FINSTAT_PRIVATE_KEY: privateKey,
    FINSTAT_BASE_URL: baseUrl,
    allSet: apiKey && privateKey,
    baseUrl: process.env.FINSTAT_BASE_URL || DEFAULT_FINSTAT_BASE_URL,
  };
}

/** Load credentials or throw. Never logs the values. */
export function getFinstatCredentials(): FinstatCredentials {
  const apiKey = process.env.FINSTAT_API_KEY;
  const privateKey = process.env.FINSTAT_PRIVATE_KEY;
  if (!apiKey || !privateKey) {
    throw new FinstatAuthError(
      "Finstat API credentials are not configured on the server.",
    );
  }
  return {
    apiKey,
    privateKey,
    baseUrl: process.env.FINSTAT_BASE_URL || DEFAULT_FINSTAT_BASE_URL,
  };
}

/**
 * Request signing — compute the verification hash Finstat expects.
 *
 * ⚠️ PLACEHOLDER — currently rejected by the API (403 "Invalid verification
 * hash."). Replace strictly per the official PREMIUM API documentation.
 * Do not guess variations.
 */
export function computeFinstatHash(value: string): string {
  const { apiKey, privateKey } = getFinstatCredentials();
  return createHash("sha256")
    .update(`${apiKey}+${privateKey}+${value}`)
    .digest("hex");
}

/** Build the fully-qualified endpoint URL for a Finstat API path. */
export function buildFinstatEndpoint(path: string): string {
  const { baseUrl } = getFinstatCredentials();
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

/**
 * Serialize the request body Finstat expects (form-urlencoded), injecting
 * the API key and station identifiers. Every signed request goes through
 * this so the shape stays consistent.
 */
export function serializeFinstatParams(params: Record<string, string>): string {
  const { apiKey } = getFinstatCredentials();
  return new URLSearchParams({
    apiKey,
    StationId: FINSTAT_STATION_ID,
    StationName: FINSTAT_STATION_NAME,
    Json: "1",
    ...params,
  }).toString();
}

export interface SignedFinstatRequest {
  endpoint: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
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
  const hash = computeFinstatHash(hashInput);
  const body = serializeFinstatParams({ ...params, Hash: hash });
  return {
    endpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  };
}
