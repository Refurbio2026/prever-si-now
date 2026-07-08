// Base provider contract and small helpers.
// All providers are server-only (`.server.ts`) and async.

import type {
  ProviderCapability,
  ProviderSourceId,
  ProviderSourceStatus,
  ProviderState,
} from "./types";

export interface ProviderResult<T> {
  data: T;
  status: ProviderSourceStatus;
}

export function ok<T>(
  source: ProviderSourceId,
  capability: ProviderCapability,
  data: T,
  durationMs?: number,
): ProviderResult<T> {
  return {
    data,
    status: { source, capability, state: "ok", durationMs },
  };
}

export function empty<T>(
  source: ProviderSourceId,
  capability: ProviderCapability,
  data: T,
  message?: string,
): ProviderResult<T> {
  return { data, status: { source, capability, state: "empty", message } };
}

export function unavailable<T>(
  source: ProviderSourceId,
  capability: ProviderCapability,
  fallback: T,
  state: Extract<ProviderState, "unavailable" | "not_configured" | "error"> = "unavailable",
  message?: string,
): ProviderResult<T> {
  return {
    data: fallback,
    status: { source, capability, state, message },
  };
}

/** Race all providers, never let one failure block the others. */
export async function runAll<T>(
  tasks: Array<{ label: string; run: () => Promise<ProviderResult<T>> }>,
): Promise<ProviderResult<T>[]> {
  const settled = await Promise.allSettled(tasks.map((t) => timed(t.run)));
  return settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const task = tasks[i];
    return {
      data: undefined as unknown as T,
      status: {
        source: "internal" as ProviderSourceId,
        capability: "company",
        state: "error",
        message: `${task.label}: ${(s.reason as Error)?.message ?? "unknown error"}`,
      },
    };
  });
}

async function timed<T>(fn: () => Promise<ProviderResult<T>>): Promise<ProviderResult<T>> {
  const start = Date.now();
  const res = await fn();
  return { ...res, status: { ...res.status, durationMs: Date.now() - start } };
}
