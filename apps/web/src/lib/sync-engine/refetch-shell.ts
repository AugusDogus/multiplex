"use client";

import {
  refetchLibraryHubsForServer,
  warmMediaItem,
  type SyncEngineCollections,
} from "./collections";
import { getActiveSyncEngineCollections } from "./registry";
import { getSyncEngineTrpcClient } from "./trpc-client";

async function refetchContinueWatching(
  collection: SyncEngineCollections["continueWatching"],
): Promise<void> {
  // Persisted posters can be visible before the first network query settles.
  // TanStack joins that initial request on refetch, so wait before requesting
  // post-removal data rather than accepting its pre-removal response.
  if (collection.status === "loading") await collection.preload();
  await collection.utils.refetch({ throwOnError: true });
}

/** Reconcile home and cached or loading library Recommended rows after removal. */
export async function refetchSyncedContinueWatching(
  serverId: string,
): Promise<void> {
  const collections = getActiveSyncEngineCollections();
  if (!collections) return;

  await Promise.all([
    refetchContinueWatching(collections.continueWatching),
    refetchLibraryHubsForServer(
      collections,
      getSyncEngineTrpcClient(),
      serverId,
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
