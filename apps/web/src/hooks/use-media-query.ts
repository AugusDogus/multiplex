"use client";

import { useSyncExternalStore } from "react";

const BREAKPOINTS = {
  "2xl": 1536,
  "3xl": 1600,
  "4xl": 2000,
  lg: 1024,
  md: 768,
  sm: 640,
  xl: 1280,
} as const;

type Breakpoint = keyof typeof BREAKPOINTS;

const breakpointValues = new Map<string, number>(Object.entries(BREAKPOINTS));

type BreakpointQuery =
  | Breakpoint
  | `max-${Breakpoint}`
  | `${Breakpoint}:max-${Breakpoint}`;

function resolveMin(value: string | number): string {
  const px = breakpointValues.get(String(value)) ?? Number(value);
  return `(min-width: ${px}px)`;
}

function resolveMax(value: string | number): string {
  const px = breakpointValues.get(String(value)) ?? Number(value);
  return `(max-width: ${px - 1}px)`;
}

function parseQuery(
  query: BreakpointQuery | MediaQueryInput | (string & {}),
): string {
  if (query instanceof Object) {
    const parts: string[] = [];
    if (query.min !== undefined) parts.push(resolveMin(query.min));
    if (query.max !== undefined) parts.push(resolveMax(query.max));
    if (query.pointer === "coarse") parts.push("(pointer: coarse)");
    if (query.pointer === "fine") parts.push("(pointer: fine)");
    if (parts.length === 0) return "(min-width: 0px)";
    return parts.join(" and ");
  }

  const queryText = String(query);
  if (queryText.startsWith("(")) return queryText;

  const parts: string[] = [];
  for (const segment of queryText.split(":")) {
    if (segment.startsWith("max-")) {
      const bp = segment.slice(4);
      if (breakpointValues.has(bp)) parts.push(resolveMax(bp));
    } else if (segment in BREAKPOINTS) {
      parts.push(resolveMin(segment));
    }
  }

  return parts.length > 0 ? parts.join(" and ") : queryText;
}

function getServerSnapshot(): boolean {
  return false;
}

export type MediaQueryInput = {
  min?: Breakpoint | number;
  max?: Breakpoint | number;
  /** Touch-like input (finger). Use "fine" for mouse/trackpad. */
  pointer?: "coarse" | "fine";
};

export function useMediaQuery(
  query: BreakpointQuery | MediaQueryInput | (string & {}),
): boolean {
  const mediaQuery = parseQuery(query);

  const subscribe = (callback: () => void) => {
    if (!globalThis.window) return () => undefined;
    const mql = globalThis.window.matchMedia(mediaQuery);
    mql.addEventListener("change", callback);
    return () => mql.removeEventListener("change", callback);
  };

  const getSnapshot = () => {
    if (!globalThis.window) return false;
    return globalThis.window.matchMedia(mediaQuery).matches;
  };

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useIsMobile(): boolean {
  return useMediaQuery("max-md");
}
