"use client";

import type { SyncEngineCollections } from "./collections";

let activeCollections: SyncEngineCollections | null = null;

/** Set by SyncEngineProvider when OPFS collections are ready. */
export function setActiveSyncEngineCollections(
  collections: SyncEngineCollections | null,
): void {
  activeCollections = collections;
}

export function getActiveSyncEngineCollections(): SyncEngineCollections | null {
  return activeCollections;
}
