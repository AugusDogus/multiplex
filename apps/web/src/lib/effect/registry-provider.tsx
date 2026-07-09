"use client";

import { RegistryProvider } from "@effect/atom-react";
import type { ReactNode } from "react";

/**
 * Client-only atom registry for `@effect/atom-react`.
 *
 * Mounted inside the root layout's client provider tree so SSR never
 * evaluates session atoms. Mirrors executor's `RegistryProvider` usage.
 */
export function EffectRegistryProvider({ children }: { children: ReactNode }) {
  return <RegistryProvider>{children}</RegistryProvider>;
}
