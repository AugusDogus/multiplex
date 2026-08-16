"use client";

import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";

import type {
  SanitizedContinueWatchingRow,
  SanitizedHomeHubRow,
  SanitizedItemPlaylistsRow,
  SanitizedLibraryFilterValuesRow,
  SanitizedLibraryHubsSnapshotRow,
  SanitizedMediaItemRow,
  SanitizedPlayQueueRow,
  SanitizedPlaylistContentsRow,
  SanitizedPlaylistRow,
  SanitizedSearchResultsRow,
  SanitizedServerLibraryRow,
  SanitizedUserInfoRow,
  SanitizedWatchTogetherInviteeRow,
  SanitizedWatchTogetherRoomRow,
} from "./sanitize";

/**
 * Stable empty collections so live subscriptions can run before the OPFS
 * engine finishes booting (hooks must not be called conditionally).
 */
function emptyCollection<T extends { id: string }>(id: string) {
  return createCollection(
    localOnlyCollectionOptions({
      id: `sync-engine-empty-${id}`,
      getKey: (row: T) => row.id,
    }),
  );
}

export const emptyContinueWatchingCollection =
  emptyCollection<SanitizedContinueWatchingRow>("continue-watching");
export const emptyHomeHubsCollection =
  emptyCollection<SanitizedHomeHubRow>("home-hubs");
export const emptyServerLibrariesCollection =
  emptyCollection<SanitizedServerLibraryRow>("server-libraries");
export const emptyMediaItemsCollection =
  emptyCollection<SanitizedMediaItemRow>("media-items");
export const emptyWatchTogetherRoomsCollection =
  emptyCollection<SanitizedWatchTogetherRoomRow>("watch-together-rooms");
export const emptyUserInfoCollection =
  emptyCollection<SanitizedUserInfoRow>("user-info");
export const emptyWatchTogetherInviteesCollection =
  emptyCollection<SanitizedWatchTogetherInviteeRow>(
    "watch-together-invitees",
  );
export const emptyLibraryHubsCollection =
  emptyCollection<SanitizedLibraryHubsSnapshotRow>("library-hubs");
export const emptySearchResultsCollection =
  emptyCollection<SanitizedSearchResultsRow>("search-results");
export const emptyPlaylistsCollection =
  emptyCollection<SanitizedPlaylistRow>("playlists");
export const emptyPlaylistContentsCollection =
  emptyCollection<SanitizedPlaylistContentsRow>("playlist-contents");
export const emptyItemPlaylistsCollection =
  emptyCollection<SanitizedItemPlaylistsRow>("item-playlists");
export const emptyLibraryFilterValuesCollection =
  emptyCollection<SanitizedLibraryFilterValuesRow>("library-filter-values");
export const emptyPlayQueuesCollection =
  emptyCollection<SanitizedPlayQueueRow>("play-queues");
