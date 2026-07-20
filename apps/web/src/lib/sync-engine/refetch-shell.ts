"use client";

import { getActiveSyncEngineCollections } from "./registry";

/** Refetch Plex shell collections after mutations that used to invalidate tRPC keys. */
export function refetchSyncedShellCollections(): Promise<void> {
  const collections = getActiveSyncEngineCollections();
  if (!collections) return Promise.resolve();

  return Promise.allSettled([
    collections.continueWatching.utils.refetch?.(),
    collections.homeHubs.utils.refetch?.(),
    collections.serverLibraries.utils.refetch?.(),
  ]).then(() => undefined);
}
