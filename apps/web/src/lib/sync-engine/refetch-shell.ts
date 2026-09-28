"use client";

import { warmLibraryHubs, warmMediaItem } from "./collections";
import { getActiveSyncEngineCollections } from "./registry";
import { getSyncEngineTrpcClient } from "./trpc-client";

/** Reconcile both home and already-cached library Recommended rows after removal. */
export async function refetchSyncedContinueWatching(
  serverId: string,
): Promise<void> {
  const collections = getActiveSyncEngineCollections();
  if (!collections) return;

  await Promise.all([
    collections.continueWatching.utils.refetch({ throwOnError: true }),
    ...collections.libraryHubs.toArray
      .filter((snapshot) => snapshot.machineIdentifier === serverId)
      .map(({ machineIdentifier, sectionId }) =>
        warmLibraryHubs(collections, getSyncEngineTrpcClient(), {
          machineIdentifier,
          sectionId,
        }),
      ),
  ]);
}

/** Refetch Plex shell collections after mutations that used to invalidate tRPC keys. */
export function refetchSyncedShellCollections(): Promise<void> {
  const collections = getActiveSyncEngineCollections();
  if (!collections) return Promise.resolve();

  return Promise.allSettled([
    collections.continueWatching.utils.refetch(),
    collections.homeHubs.utils.refetch(),
    collections.serverLibraries.utils.refetch(),
    collections.watchTogetherRooms.utils.refetch(),
    collections.userInfo.utils.refetch(),
  ]).then(() => undefined);
}

export function refetchSyncedWatchTogetherRooms(): Promise<void> {
  const collections = getActiveSyncEngineCollections();
  if (!collections) return Promise.resolve();
  return Promise.resolve(collections.watchTogetherRooms.utils.refetch()).then(
    () => undefined,
  );
}

export function refetchSyncedMediaItem(
  serverId: string,
  ratingKey: string,
): Promise<void> {
  const collections = getActiveSyncEngineCollections();
  if (!collections) return Promise.resolve();
  return warmMediaItem(collections, getSyncEngineTrpcClient(), {
    serverId,
    ratingKey,
  }).then(() => undefined);
}
