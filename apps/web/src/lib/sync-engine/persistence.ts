"use client";

import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  type PersistedCollectionPersistence,
} from "@tanstack/browser-db-sqlite-persistence";

export const SYNC_ENGINE_DB_NAME = "multiplex-sync-engine";
/** Bump when persisted row shapes change (clears OPFS and re-syncs). */
export const SYNC_ENGINE_SCHEMA_VERSION = 5;

export type SyncEnginePersistence = {
  persistence: PersistedCollectionPersistence;
  coordinator: BrowserCollectionCoordinator;
  databaseName: string;
  close: () => Promise<void>;
};

let persistencePromise: Promise<SyncEnginePersistence> | undefined;
let activeDatabaseName: string | undefined;

/** Filesystem-safe OPFS DB name scoped to the signed-in account. */
export function syncEngineDatabaseName(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return `${SYNC_ENGINE_DB_NAME}-${safe || "anonymous"}`;
}

export function getActiveSyncEngineDatabaseName(): string | undefined {
  return activeDatabaseName;
}

async function removeOpfsEntryBestEffort(
  root: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  try {
    await root.removeEntry(name);
  } catch {
    // Missing / locked — ignore.
  }
}

/** Delete known OPFS artifacts for a database name (best-effort). */
export async function removeSyncEngineOpfsFiles(
  databaseName: string,
): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
    return;
  }
  const root = await navigator.storage.getDirectory();
  const candidates = [
    databaseName,
    `${databaseName}-journal`,
    `${databaseName}-wal`,
    `${databaseName}-shm`,
    `${databaseName}.sqlite`,
    `${databaseName}.sqlite-journal`,
    `${databaseName}.sqlite-wal`,
    `${databaseName}.sqlite-shm`,
  ];
  await Promise.all(
    candidates.map((name) => removeOpfsEntryBestEffort(root, name)),
  );
}

/**
 * Shared OPFS SQLite persistence for sync-engine collections.
 * Multi-tab safe via BrowserCollectionCoordinator.
 * `userId` scopes the DB so account switches cannot read another user's replica.
 */
export function getSyncEnginePersistence(
  userId: string,
): Promise<SyncEnginePersistence> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("Sync engine persistence is browser-only (OPFS)."),
    );
  }

  const databaseName = syncEngineDatabaseName(userId);
  if (persistencePromise && activeDatabaseName === databaseName) {
    return persistencePromise;
  }

  const previousPromise = persistencePromise;
  activeDatabaseName = databaseName;

  persistencePromise = (async () => {
    if (previousPromise) {
      const previous = await previousPromise.catch(() => null);
      if (previous?.databaseName === databaseName) {
        return previous;
      }
      await previous?.close().catch(() => undefined);
    }

    // Drop the legacy unscoped DB if present (pre-user-scoping).
    await removeSyncEngineOpfsFiles(SYNC_ENGINE_DB_NAME);

    const database = await openBrowserWASQLiteOPFSDatabase({
      databaseName,
    });
    const coordinator = new BrowserCollectionCoordinator({
      dbName: databaseName,
    });
    const persistence = createBrowserWASQLitePersistence({
      database,
      coordinator,
    });

    const handle: SyncEnginePersistence = {
      persistence,
      coordinator,
      databaseName,
      close: async () => {
        coordinator.dispose();
        await Promise.resolve(database.close?.()).catch(() => undefined);
        // Only clear module state if this handle is still the active open DB.
        if (activeDatabaseName === databaseName) {
          activeDatabaseName = undefined;
          persistencePromise = undefined;
        }
      },
    };
    return handle;
  })();

  return persistencePromise;
}

/**
 * Close the active persistence handle and delete its OPFS files.
 * Call on logout so the next account cannot read the prior replica.
 */
export async function closeAndWipeSyncEnginePersistence(): Promise<void> {
  const databaseName = activeDatabaseName;
  const pending = persistencePromise;
  persistencePromise = undefined;
  activeDatabaseName = undefined;

  if (pending) {
    const handle = await pending.catch(() => null);
    await handle?.close().catch(() => undefined);
  }

  if (databaseName) {
    await removeSyncEngineOpfsFiles(databaseName);
  }
  // Also wipe legacy unscoped name.
  await removeSyncEngineOpfsFiles(SYNC_ENGINE_DB_NAME);
}

/** Test / HMR helper. */
export function resetSyncEnginePersistenceForTests(): void {
  persistencePromise = undefined;
  activeDatabaseName = undefined;
}
