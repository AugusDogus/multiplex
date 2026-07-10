"use client";

import { Context, Data, Effect, Layer, ManagedRuntime } from "effect";
import type {
  ItemMetadata,
  PlayQueueResponse,
  WatchTogetherRoom,
} from "@multiplex/plex-query";

import type * as S from "~/server/effect-api/schemas";

import {
  makePlexHttpApiClient,
  plexHttpClientLayer,
  type PlexHttpApiClient,
} from "./plex-api-client";
import {
  asItemMetadata,
  asPlayQueue,
  asWatchTogetherRoom,
  asWatchTogetherRooms,
} from "./plex-boundary";

export class WatchTogetherApiError extends Data.TaggedError(
  "WatchTogetherApiError",
)<{
  readonly cause: unknown;
  readonly operation: string;
}> {}

type UserInfo = typeof S.UserInfo.Type;
type CreateRoomBody = typeof S.CreateWatchTogetherRoomBody.Type;
type CreatePlayQueueBody = typeof S.CreatePlayQueueBody.Type;
type GetPlayQueueQuery = typeof S.GetPlayQueueQuery.Type;

export type WatchTogetherApiShape = {
  readonly listRooms: () => Effect.Effect<
    WatchTogetherRoom[],
    WatchTogetherApiError
  >;
  readonly getRoom: (
    roomId: string,
  ) => Effect.Effect<WatchTogetherRoom, WatchTogetherApiError>;
  readonly createRoom: (
    input: CreateRoomBody,
  ) => Effect.Effect<WatchTogetherRoom, WatchTogetherApiError>;
  readonly deleteRoom: (
    roomId: string,
  ) => Effect.Effect<void, WatchTogetherApiError>;
  readonly getItemMetadata: (input: {
    serverId: string;
    ratingKey: string;
  }) => Effect.Effect<ItemMetadata, WatchTogetherApiError>;
  readonly getUserInfo: () => Effect.Effect<UserInfo, WatchTogetherApiError>;
  readonly createPlayQueue: (
    input: CreatePlayQueueBody,
  ) => Effect.Effect<PlayQueueResponse, WatchTogetherApiError>;
  readonly getPlayQueue: (
    input: GetPlayQueueQuery,
  ) => Effect.Effect<PlayQueueResponse, WatchTogetherApiError>;
};

const wrap = <A>(
  operation: string,
  effect: Effect.Effect<A, unknown>,
): Effect.Effect<A, WatchTogetherApiError> =>
  effect.pipe(
    Effect.mapError((cause) => new WatchTogetherApiError({ cause, operation })),
  );

export const makeWatchTogetherApi = (
  client: PlexHttpApiClient,
): WatchTogetherApiShape => ({
  listRooms: () =>
    wrap(
      "listRooms",
      client.watchTogether
        .getWatchTogetherRooms()
        .pipe(Effect.map(asWatchTogetherRooms)),
    ),
  getRoom: (roomId) =>
    wrap(
      "getRoom",
      client.watchTogether
        .getWatchTogetherRoom({ params: { roomId } })
        .pipe(Effect.map(asWatchTogetherRoom)),
    ),
  createRoom: (input) =>
    wrap(
      "createRoom",
      client.watchTogether
        .createWatchTogetherRoom({ payload: input })
        .pipe(Effect.map(asWatchTogetherRoom)),
    ),
  deleteRoom: (roomId) =>
    wrap(
      "deleteRoom",
      client.watchTogether.deleteWatchTogetherRoom({
        params: { roomId },
      }),
    ),
  getItemMetadata: (input) =>
    wrap(
      "getItemMetadata",
      client.library
        .getItemMetadata({ query: input })
        .pipe(Effect.map(asItemMetadata)),
    ),
  getUserInfo: () => wrap("getUserInfo", client.account.getUserInfo()),
  createPlayQueue: (input) =>
    wrap(
      "createPlayQueue",
      client.playback
        .createPlayQueue({ payload: input })
        .pipe(Effect.map(asPlayQueue)),
    ),
  getPlayQueue: (input) =>
    wrap(
      "getPlayQueue",
      client.playback
        .getPlayQueue({ query: input })
        .pipe(Effect.map(asPlayQueue)),
    ),
});

let browserHttpClient: PlexHttpApiClient | undefined;

const getBrowserHttpClient = (): PlexHttpApiClient => {
  if (browserHttpClient) {
    return browserHttpClient;
  }
  const runtime = ManagedRuntime.make(plexHttpClientLayer);
  browserHttpClient = runtime.runSync(makePlexHttpApiClient());
  return browserHttpClient;
};

/**
 * Browser-side Plex/Watch Together API boundary over the Effect HttpApi client.
 *
 * Effect v4 (`4.0.0-beta.59`) exposes services via `Context.Service` (the
 * older `Effect.Service` helper is not present in this beta).
 */
export class WatchTogetherApi extends Context.Service<
  WatchTogetherApi,
  WatchTogetherApiShape
>()("WatchTogetherApi") {
  static readonly Default = Layer.sync(WatchTogetherApi, () =>
    makeWatchTogetherApi(getBrowserHttpClient()),
  );

  /** Test / alternate-transport layer with an injectable HttpApi client. */
  static readonly layer = (client: PlexHttpApiClient) =>
    Layer.succeed(WatchTogetherApi)(makeWatchTogetherApi(client));
}
