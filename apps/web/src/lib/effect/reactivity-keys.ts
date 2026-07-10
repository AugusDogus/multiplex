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
