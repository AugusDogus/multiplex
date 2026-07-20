import { cache } from "react";

/**
 * Temporary request-scoped home-load timing for preview evidence.
 * Enabled when the home page is requested with `?diag=1`.
 * Remove once the hang root cause is demonstrated and fixed.
 */

export type HomeDiagSpan = {
  label: string;
  ms: number;
  detail?: Record<string, unknown>;
};

type HomeDiagState = {
  enabled: boolean;
  spans: HomeDiagSpan[];
};

const getHomeDiagState = cache(
  (): HomeDiagState => ({
    enabled: false,
    spans: [],
  }),
);

export function enableHomeLoadDiag(): void {
  getHomeDiagState().enabled = true;
}

export function isHomeLoadDiagEnabled(): boolean {
  return getHomeDiagState().enabled;
}

export function recordHomeDiagSpan(
  label: string,
  ms: number,
  detail?: Record<string, unknown>,
): void {
  const state = getHomeDiagState();
  if (!state.enabled) return;
  state.spans.push({ label, ms, detail });
}

export async function withHomeDiagSpan<T>(
  label: string,
  fn: () => Promise<T>,
  detail?: Record<string, unknown>,
): Promise<T> {
  if (!isHomeLoadDiagEnabled()) {
    return fn();
  }
  const start = performance.now();
  try {
    return await fn();
  } finally {
    recordHomeDiagSpan(label, performance.now() - start, detail);
  }
}

export function getHomeDiagSpans(): HomeDiagSpan[] {
  return getHomeDiagState().spans;
}
