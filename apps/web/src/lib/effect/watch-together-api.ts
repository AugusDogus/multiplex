"use client";

import { createTRPCClient, type TRPCClient } from "@trpc/client";
import { Context, Data, Effect, Layer } from "effect";

import type { AppRouter } from "~/server/api/root";
import { createTrpcClientLinks } from "~/trpc/client-links";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";

export class WatchTogetherApiError extends Data.TaggedError(
  "WatchTogetherApiError",
)<{
  readonly cause: unknown;
  readonly operation: string;
}> {}

/** Subset of the plex tRPC client used by Watch Together session orchestration. */
export type WatchTogetherTrpcClient = Pick<
  TRPCClient<AppRouter>["plex"],
  | "getWatchTogetherRooms"
  | "getWatchTogetherRoom"
  | "createWatchTogetherRoom"
  | "deleteWatchTogetherRoom"
  | "getItemMetadata"
  | "getUserInfo"
  | "createPlayQueue"
  | "getPlayQueue"
>;

export type WatchTogetherApiShape = {
  readonly listRooms: () => Effect.Effect<
    RouterOutputs["plex"]["getWatchTogetherRooms"],
    WatchTogetherApiError
  >;
  readonly getRoom: (
    roomId: RouterInputs["plex"]["getWatchTogetherRoom"]["roomId"],
  ) => Effect.Effect<
    RouterOutputs["plex"]["getWatchTogetherRoom"],
    WatchTogetherApiError
  >;
  readonly createRoom: (
    input: RouterInputs["plex"]["createWatchTogetherRoom"],
  ) => Effect.Effect<
    RouterOutputs["plex"]["createWatchTogetherRoom"],
    WatchTogetherApiError
  >;
  readonly deleteRoom: (
    roomId: RouterInputs["plex"]["deleteWatchTogetherRoom"]["roomId"],
  ) => Effect.Effect<
    RouterOutputs["plex"]["deleteWatchTogetherRoom"],
    WatchTogetherApiError
  >;
  readonly getItemMetadata: (input: {
    serverId: string;
    ratingKey: string;
  }) => Effect.Effect<
    RouterOutputs["plex"]["getItemMetadata"],
    WatchTogetherApiError
  >;
  readonly getUserInfo: () => Effect.Effect<
    RouterOutputs["plex"]["getUserInfo"],
    WatchTogetherApiError
  >;
  readonly createPlayQueue: (
    input: RouterInputs["plex"]["createPlayQueue"],
  ) => Effect.Effect<
    RouterOutputs["plex"]["createPlayQueue"],
    WatchTogetherApiError
  >;
  readonly getPlayQueue: (
    input: RouterInputs["plex"]["getPlayQueue"],
  ) => Effect.Effect<
    RouterOutputs["plex"]["getPlayQueue"],
    WatchTogetherApiError
  >;
};

let browserClient: WatchTogetherTrpcClient | undefined;

const createBrowserTrpcClient = (): WatchTogetherTrpcClient => {
  const client = createTRPCClient<AppRouter>({
    links: createTrpcClientLinks("effect-watch-together-api"),
  });
  return client.plex;
};

const getBrowserTrpcClient = (): WatchTogetherTrpcClient => {
  browserClient ??= createBrowserTrpcClient();
  return browserClient;
};

const wrap =
  <A>(operation: string, try_: () => Promise<A>) =>
  (): Effect.Effect<A, WatchTogetherApiError> =>
    Effect.tryPromise({
      try: try_,
      catch: (cause) => new WatchTogetherApiError({ cause, operation }),
    });

export const makeWatchTogetherApi = (
  client: WatchTogetherTrpcClient = getBrowserTrpcClient(),
): WatchTogetherApiShape => ({
  listRooms: wrap("listRooms", () => client.getWatchTogetherRooms.query()),
  getRoom: (roomId) =>
    wrap("getRoom", () => client.getWatchTogetherRoom.query({ roomId }))(),
  createRoom: (input) =>
    wrap("createRoom", () => client.createWatchTogetherRoom.mutate(input))(),
  deleteRoom: (roomId) =>
    wrap("deleteRoom", () =>
      client.deleteWatchTogetherRoom.mutate({ roomId }),
    )(),
  getItemMetadata: (input) =>
    wrap("getItemMetadata", () => client.getItemMetadata.query(input))(),
  getUserInfo: wrap("getUserInfo", () => client.getUserInfo.query()),
  createPlayQueue: (input) =>
    wrap("createPlayQueue", () => client.createPlayQueue.mutate(input))(),
  getPlayQueue: (input) =>
    wrap("getPlayQueue", () => client.getPlayQueue.query(input))(),
});

/**
 * Browser-side Plex/Watch Together API boundary over the vanilla tRPC client.
 *
 * Effect v4 (`4.0.0-beta.59`) exposes services via `Context.Service` (the
 * older `Effect.Service` helper is not present in this beta).
 */
export class WatchTogetherApi extends Context.Service<
  WatchTogetherApi,
  WatchTogetherApiShape
>()("WatchTogetherApi") {
  static readonly Default = Layer.sync(WatchTogetherApi, () =>
    makeWatchTogetherApi(),
  );

  /** Test / alternate-transport layer with an injectable tRPC client. */
  static readonly layer = (client: WatchTogetherTrpcClient) =>
    Layer.succeed(WatchTogetherApi)(makeWatchTogetherApi(client));
}
