"use client";

import type { ReactNode } from "react";

import { SyncEngineProvider } from "./provider";

/** Client boundary so the authenticated app shell can boot OPFS sync. */
export function SyncEngineAppShell({ children }: { children: ReactNode }) {
  return <SyncEngineProvider>{children}</SyncEngineProvider>;
}
