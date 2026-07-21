/**
 * Stable collection row keys for the TanStack DB sync engine.
 * Keep these pure so unit tests can cover them without browser APIs.
 */

export function serverRowKey(clientIdentifier: string): string {
  return clientIdentifier;
}

export function continueWatchingRowKey(
  serverId: string,
  ratingKey: string,
): string {
  return `${serverId}:${ratingKey}`;
}

export function homeHubRowKey(serverId: string, hubKey: string): string {
  return `${serverId}:${hubKey}`;
}

export function libraryHubsSnapshotKey(
  machineIdentifier: string,
  sectionId: string,
): string {
  return `${machineIdentifier}:${sectionId}`;
}

export function serverLibraryRowKey(serverId: string): string {
  return serverId;
}

export function mediaItemRowKey(serverId: string, ratingKey: string): string {
  return `${serverId}:${ratingKey}`;
}

export function browsePageRowKey(
  contentKey: string,
  pageSize: number,
  pageIndex: number,
): string {
  return `${contentKey}:${pageSize}:${pageIndex}`;
}

export function playlistRowKey(
  serverId: string,
  playlistRatingKey: string,
): string {
  return `${serverId}:${playlistRatingKey}`;
}

export function playlistContentsRowKey(
  serverId: string,
  playlistRatingKey: string,
  start: number,
  size: number,
): string {
  return `${serverId}:${playlistRatingKey}:${start}:${size}`;
}

export function itemPlaylistsRowKey(
  serverId: string,
  playlistType: string,
): string {
  return `${serverId}:${playlistType}`;
}

export function libraryFilterValuesRowKey(
  machineIdentifier: string,
  filterPath: string,
): string {
  return `${machineIdentifier}:${filterPath}`;
}

export function playQueueRowKey(serverId: string, playQueueId: string): string {
  return `${serverId}:${playQueueId}`;
}

export function searchResultsRowKey(query: string): string {
  return query.trim().toLowerCase();
}

export const USER_INFO_ROW_ID = "me";

export function parseCompositeKey(
  key: string,
): { serverId: string; localKey: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) {
    return null;
  }
  return {
    serverId: key.slice(0, separator),
    localKey: key.slice(separator + 1),
  };
}
