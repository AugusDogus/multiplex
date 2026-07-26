"use client";

import { clearConnectionOverlay } from "./connection-overlay";
import { closeAndWipeSyncEnginePersistence } from "./persistence";
import {
  getActiveSyncEngineCollections,
  setActiveSyncEngineCollections,
} from "./registry";

async function cleanupCollections(
  collections: NonNullable<ReturnType<typeof getActiveSyncEngineCollections>>,
): Promise<void> {
  await Promise.allSettled([
    collections.servers.cleanup(),
    collections.serverLibraries.cleanup(),
    collections.continueWatching.cleanup(),
    collections.homeHubs.cleanup(),
    collections.mediaItems.cleanup(),
    collections.watchTogetherRooms.cleanup(),
    collections.userInfo.cleanup(),
    collections.watchTogetherInvitees.cleanup(),
    collections.libraryHubs.cleanup(),
    collections.browsePages.cleanup(),
    collections.searchResults.cleanup(),
    collections.playlists.cleanup(),
    collections.playlistContents.cleanup(),
    collections.itemPlaylists.cleanup(),
    collections.libraryFilterValues.cleanup(),
    collections.playQueues.cleanup(),
  ]);
}

/**
 * Drop session credentials and the durable local replica.
 * Must run on logout so the next account in this tab cannot reuse tokens or OPFS rows.
 */
export async function clearSyncEngineSession(): Promise<void> {
  clearConnectionOverlay();

  const collections = getActiveSyncEngineCollections();
  setActiveSyncEngineCollections(null);
  if (collections) {
    await cleanupCollections(collections).catch(() => undefined);
  }

  await closeAndWipeSyncEnginePersistence();
}
