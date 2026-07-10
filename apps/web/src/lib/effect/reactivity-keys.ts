/**
 * Canonical reactivity keys for AtomHttpApi query/mutation invalidation.
 *
 * effect-atom's `Reactivity` service refreshes any query whose `reactivityKeys`
 * overlap with a completed mutation's `reactivityKeys`. Mutations pass keys at
 * the call site (definition-time keys are not accepted by AtomHttpApi).
 */
export const ReactivityKey = {
  watchTogetherRooms: "watchTogetherRooms",
  watchTogetherRoom: (roomId: string) => ["watchTogetherRoom", roomId] as const,
  invitees: "invitees",
  userInfo: "userInfo",
  playQueue: (playQueueId: string) => ["playQueue", playQueueId] as const,
  itemMetadata: (serverId: string, ratingKey: string) =>
    ["itemMetadata", serverId, ratingKey] as const,
  itemDetails: (serverId: string, ratingKey: string) =>
    ["itemDetails", serverId, ratingKey] as const,

  // Browse surfaces (P5-3)
  homeHubs: "homeHubs",
  continueWatching: "continueWatching",
  continueWatchingServer: (serverId: string) =>
    ["continueWatchingServer", serverId] as const,
  serverLibraries: "serverLibraries",
  pinnedSources: "pinnedSources",
  libraryHubs: (machineIdentifier: string, sectionId: string) =>
    ["libraryHubs", machineIdentifier, sectionId] as const,
  libraryContent: (
    machineIdentifier: string,
    sectionId: string,
    contentKey: string,
  ) => ["libraryContent", machineIdentifier, sectionId, contentKey] as const,
  libraryMeta: (machineIdentifier: string, sectionId: string, type?: string) =>
    ["libraryMeta", machineIdentifier, sectionId, type ?? ""] as const,
  libraryCollections: (machineIdentifier: string, sectionId: string) =>
    ["libraryCollections", machineIdentifier, sectionId] as const,
  libraryPlaylists: (machineIdentifier: string, sectionId: string) =>
    ["libraryPlaylists", machineIdentifier, sectionId] as const,
  libraryCategories: (machineIdentifier: string, sectionId: string) =>
    ["libraryCategories", machineIdentifier, sectionId] as const,
  libraryFilterValues: (machineIdentifier: string, filterPath: string) =>
    ["libraryFilterValues", machineIdentifier, filterPath] as const,
  libraryPivots: (machineIdentifier: string, sectionId: string) =>
    ["libraryPivots", machineIdentifier, sectionId] as const,
  hubContent: (machineIdentifier: string, hubKey: string) =>
    ["hubContent", machineIdentifier, hubKey] as const,
  search: (query: string) => ["search", query] as const,
  liveTvProgramming: (
    machineIdentifier: string,
    providerIdentifier: string,
    date: string,
  ) =>
    ["liveTvProgramming", machineIdentifier, providerIdentifier, date] as const,
  liveTvAllProgramming: (date: string) =>
    ["liveTvAllProgramming", date] as const,
  itemPlaylists: (serverId: string, playlistType: string) =>
    ["itemPlaylists", serverId, playlistType] as const,
} as const;

/** Create / invite / delete room — refresh room lists (and optionally a lobby). */
export const watchTogetherRoomWriteKeys = [
  ReactivityKey.watchTogetherRooms,
] as const;

export const watchTogetherRoomWriteKeysFor = (roomId: string) =>
  [
    ReactivityKey.watchTogetherRooms,
    ReactivityKey.watchTogetherRoom(roomId),
  ] as const;

/** Invitees list is relatively stable; still available for explicit invalidation. */
export const inviteesWriteKeys = [ReactivityKey.invitees] as const;

export const playQueueWriteKeysFor = (playQueueId: string) =>
  [ReactivityKey.playQueue(playQueueId)] as const;

export const itemMetadataWriteKeysFor = (serverId: string, ratingKey: string) =>
  [
    ReactivityKey.itemMetadata(serverId, ratingKey),
    ReactivityKey.itemDetails(serverId, ratingKey),
  ] as const;

/**
 * Pin / unpin sidebar sources — userInfo, continue-watching, and home hubs all
 * derive from the pinned-source list.
 */
export const pinnedSourceWriteKeys = [
  ReactivityKey.userInfo,
  ReactivityKey.pinnedSources,
  ReactivityKey.continueWatching,
  ReactivityKey.homeHubs,
] as const;

/** Mark watched / unwatched — details + continue-watching row. */
export const watchedStateWriteKeysFor = (serverId: string, ratingKey: string) =>
  [
    ...itemMetadataWriteKeysFor(serverId, ratingKey),
    ReactivityKey.continueWatching,
  ] as const;

export const itemPlaylistsWriteKeysFor = (
  serverId: string,
  playlistType: string,
) => [ReactivityKey.itemPlaylists(serverId, playlistType)] as const;
