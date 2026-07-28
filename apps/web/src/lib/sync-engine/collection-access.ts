import type { SyncEngineCollections } from "./collections";

export type SyncEngineStatus =
  | { phase: "booting" }
  | { phase: "ready"; collections: SyncEngineCollections; bootedAt: number }
  | { phase: "error"; error: string };

export function resolveSyncEngineCollections(
  status: SyncEngineStatus | null,
  activeCollections: SyncEngineCollections | null,
): SyncEngineCollections | null {
  // Root-level consumers such as the global media player are siblings of the
  // authenticated app shell. They use the account-scoped registry populated by
  // SyncEngineProvider; guest routes have no active registry and remain null.
  if (status === null) return activeCollections;
  if (status.phase !== "ready") return null;
  if (activeCollections !== status.collections) return null;
  return status.collections;
}
