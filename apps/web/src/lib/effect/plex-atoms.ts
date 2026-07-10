"use client";

import * as Atom from "effect/unstable/reactivity/Atom";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import {
  asItemDetails,
  asItemMetadata,
  asPlayQueue,
  asWatchTogetherRoom,
  asWatchTogetherRooms,
} from "./plex-boundary";
import { PlexApiClient } from "./plex-api-client";
import { ReactivityKey } from "./reactivity-keys";

// ---------------------------------------------------------------------------
// Query atoms — TTLs mirror today's tRPC staleTime / refetchInterval.
// Polling surfaces wrap with `Atom.withRefresh` so subscribed views keep
// refreshing at the previous React Query cadence while mounted.
// ---------------------------------------------------------------------------

/** Home "Watch Together" row — was refetchInterval 15s / staleTime 0. */
export const watchTogetherRoomsAtom = Atom.withRefresh(
  Atom.map(
    PlexApiClient.query("watchTogether", "getWatchTogetherRooms", {
      timeToLive: "15 seconds",
      reactivityKeys: [ReactivityKey.watchTogetherRooms],
    }),
    (result) => AsyncResult.map(result, asWatchTogetherRooms),
  ),
  "15 seconds",
);

export const watchTogetherRoomsOptimisticAtom = Atom.optimistic(
  watchTogetherRoomsAtom,
);

/** Lobby room — was refetchInterval 10s. */
export const watchTogetherRoomAtom = Atom.family((roomId: string) =>
  Atom.withRefresh(
    Atom.map(
      PlexApiClient.query("watchTogether", "getWatchTogetherRoom", {
        params: { roomId },
        timeToLive: "10 seconds",
        reactivityKeys: [ReactivityKey.watchTogetherRoom(roomId)],
      }),
      (result) => AsyncResult.map(result, asWatchTogetherRoom),
    ),
    "10 seconds",
  ),
);

/** Invitees picker — was staleTime 60s. */
export const watchTogetherInviteesAtom = PlexApiClient.query(
  "watchTogether",
  "getWatchTogetherInvitees",
  {
    timeToLive: "1 minute",
    reactivityKeys: [ReactivityKey.invitees],
  },
);

/** User identity for lobby — was staleTime 60s. */
export const userInfoAtom = PlexApiClient.query("account", "getUserInfo", {
  timeToLive: "1 minute",
  reactivityKeys: [ReactivityKey.userInfo],
});

/** Item details for a room sourceUri — was staleTime 60s. */
export const itemDetailsAtom = Atom.family(
  (key: {
    readonly serverId: string;
    readonly ratingKey: string;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.serverId || !key.ratingKey) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("library", "getItemDetails", {
        query: { serverId: key.serverId, ratingKey: key.ratingKey },
        timeToLive: "1 minute",
        reactivityKeys: [
          ReactivityKey.itemDetails(key.serverId, key.ratingKey),
        ],
      }),
      (result) => AsyncResult.map(result, asItemDetails),
    );
  },
);

/** Expanded stream metadata for the settings menu — was staleTime 5min. */
export const itemMetadataAtom = Atom.family(
  (key: {
    readonly serverId: string;
    readonly ratingKey: string;
    readonly enabled?: boolean;
  }) => {
    if (key.enabled === false || !key.serverId || !key.ratingKey) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.map(
      PlexApiClient.query("library", "getItemMetadata", {
        query: { serverId: key.serverId, ratingKey: key.ratingKey },
        timeToLive: "5 minutes",
        reactivityKeys: [
          ReactivityKey.itemMetadata(key.serverId, key.ratingKey),
        ],
      }),
      (result) => AsyncResult.map(result, asItemMetadata),
    );
  },
);

/**
 * Play-queue polling for auto-play-next — was refetchInterval 30s /
 * staleTime 15s. Disabled when inputs are empty via a static Initial atom.
 */
export const playQueueAtom = Atom.family(
  (key: {
    readonly serverId: string;
    readonly playQueueId: string;
    readonly enabled: boolean;
  }) => {
    if (!key.enabled || !key.serverId || !key.playQueueId) {
      return Atom.make(() => AsyncResult.initial(false));
    }
    return Atom.withRefresh(
      Atom.map(
        PlexApiClient.query("playback", "getPlayQueue", {
          query: {
            serverId: key.serverId,
            playQueueId: key.playQueueId,
            includeMarkers: true,
          },
          timeToLive: "15 seconds",
          reactivityKeys: [ReactivityKey.playQueue(key.playQueueId)],
        }),
        (result) => AsyncResult.map(result, asPlayQueue),
      ),
      "30 seconds",
    );
  },
);

// ---------------------------------------------------------------------------
// Mutation atoms — pass `reactivityKeys` at the call site.
// ---------------------------------------------------------------------------

export const createWatchTogetherRoom = PlexApiClient.mutation(
  "watchTogether",
  "createWatchTogetherRoom",
);

export const inviteWatchTogetherUsers = PlexApiClient.mutation(
  "watchTogether",
  "inviteWatchTogetherUsers",
);

export const deleteWatchTogetherRoom = PlexApiClient.mutation(
  "watchTogether",
  "deleteWatchTogetherRoom",
);

export const createPlayQueue = PlexApiClient.mutation(
  "playback",
  "createPlayQueue",
);

export const sendTimeline = PlexApiClient.mutation("playback", "sendTimeline");

// ---------------------------------------------------------------------------
// Optimistic surfaces
// ---------------------------------------------------------------------------

export const removeWatchTogetherRoomOptimistic =
  watchTogetherRoomsOptimisticAtom.pipe(
    Atom.optimisticFn({
      reducer: (
        current,
        arg: { readonly params: { readonly roomId: string } },
      ) =>
        AsyncResult.map(current, (rooms) =>
          rooms.filter((room) => room.id !== arg.params.roomId),
        ),
      fn: deleteWatchTogetherRoom,
    }),
  );
