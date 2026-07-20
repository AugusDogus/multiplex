"use client";

import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  type PersistedCollectionPersistence,
} from "@tanstack/browser-db-sqlite-persistence";

export const SYNC_ENGINE_DB_NAME = "multiplex-sync-engine";
/** Bump when persisted row shapes change (clears OPFS and re-syncs). */
export const SYNC_ENGINE_SCHEMA_VERSION = 3;

export type SyncEnginePersistence = {
  persistence: PersistedCollectionPersistence;
  coordinator: BrowserCollectionCoordinator;
  close: () => Promise<void>;
};

let persistencePromise: Promise<SyncEnginePersistence> | undefined;

/**
 * Shared OPFS SQLite persistence for all spike collections.
 * Multi-tab safe via BrowserCollectionCoordinator.
 */
export function getSyncEnginePersistence(): Promise<SyncEnginePersistence> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("Sync engine persistence is browser-only (OPFS)."),
    );
  }

  persistencePromise ??= (async () => {
    const database = await openBrowserWASQLiteOPFSDatabase({
      databaseName: SYNC_ENGINE_DB_NAME,
    });
    const coordinator = new BrowserCollectionCoordinator({
      dbName: SYNC_ENGINE_DB_NAME,
    });
    const persistence = createBrowserWASQLitePersistence({
      database,
      coordinator,
    });

    return {
      persistence,
      coordinator,
      close: async () => {
        coordinator.dispose();
        persistencePromise = undefined;
      },
    };
  })();

  return persistencePromise;
}

/** Test / HMR helper. */
export function resetSyncEnginePersistenceForTests(): void {
  persistencePromise = undefined;
}
