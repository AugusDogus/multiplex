"use client";

import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";

/**
 * Stable empty collections so `useLiveQuery` can run before the OPFS engine
 * finishes booting (hooks must not be called conditionally).
 */
function emptyCollection(id: string) {
  return createCollection(
    localOnlyCollectionOptions({
      id: `sync-engine-empty-${id}`,
      getKey: (row: { id: string }) => row.id,
    }),
  );
}

export const emptyServersCollection = emptyCollection("servers");
export const emptyContinueWatchingCollection =
  emptyCollection("continue-watching");
export const emptyHomeHubsCollection = emptyCollection("home-hubs");
export const emptyServerLibrariesCollection =
  emptyCollection("server-libraries");
export const emptyMediaItemsCollection = emptyCollection("media-items");
