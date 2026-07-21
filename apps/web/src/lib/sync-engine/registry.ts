"use client";

import type { SyncEngineCollections } from "./collections";

type Listener = () => void;

let activeCollections: SyncEngineCollections | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Set by SyncEngineProvider / logout teardown when OPFS collections change. */
export function setActiveSyncEngineCollections(
  collections: SyncEngineCollections | null,
): void {
  if (activeCollections === collections) return;
  activeCollections = collections;
  emit();
}

export function getActiveSyncEngineCollections(): SyncEngineCollections | null {
  return activeCollections;
}

/** Subscribe to registry changes (logout clears → providers/hooks re-render). */
export function subscribeActiveSyncEngineCollections(
  listener: Listener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
