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
export const emptyWatchTogetherRoomsCollection = emptyCollection(
  "watch-together-rooms",
);
export const emptyUserInfoCollection = emptyCollection("user-info");
export const emptyWatchTogetherInviteesCollection = emptyCollection(
  "watch-together-invitees",
);
export const emptyLibraryHubsCollection = emptyCollection("library-hubs");
export const emptyBrowsePagesCollection = emptyCollection("browse-pages");
export const emptySearchResultsCollection = emptyCollection("search-results");
export const emptyPlaylistsCollection = emptyCollection("playlists");
export const emptyPlaylistContentsCollection =
  emptyCollection("playlist-contents");
export const emptyItemPlaylistsCollection = emptyCollection("item-playlists");
export const emptyLibraryFilterValuesCollection = emptyCollection(
  "library-filter-values",
);
export const emptyPlayQueuesCollection = emptyCollection("play-queues");
