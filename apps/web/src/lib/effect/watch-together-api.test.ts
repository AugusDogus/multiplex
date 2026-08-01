import { Effect, Exit, Result } from "effect";
import { expect, mock, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";

import {
  makeWatchTogetherApi,
  WatchTogetherApiError,
  type WatchTogetherTrpcClient,
} from "./watch-together-api";

const expectApiError = (
  exit: Exit.Exit<unknown, WatchTogetherApiError>,
  expected: { operation: string; cause: unknown },
) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) return;

  const found = Exit.findError(exit);
  expect(Result.isSuccess(found)).toBe(true);
  if (!Result.isSuccess(found)) return;

  const error = Result.getOrThrow(found);
  expect(error).toBeInstanceOf(WatchTogetherApiError);
  expect(error).toMatchObject({
    _tag: "WatchTogetherApiError",
    operation: expected.operation,
    cause: expected.cause,
  });
};

const makeStubClient = (
  overrides: Partial<{
    [K in keyof WatchTogetherTrpcClient]: Partial<WatchTogetherTrpcClient[K]>;
  }> = {},
): WatchTogetherTrpcClient =>
  fromPartial<WatchTogetherTrpcClient>({
    getWatchTogetherRooms: {
      query: mock().mockResolvedValue([]),
      ...overrides.getWatchTogetherRooms,
    },
    createWatchTogetherRoom: {
      mutate: mock(),
      ...overrides.createWatchTogetherRoom,
    },
    deleteWatchTogetherRoom: {
      mutate: mock().mockResolvedValue(undefined),
      ...overrides.deleteWatchTogetherRoom,
    },
    getItemMetadata: {
      query: mock(),
      ...overrides.getItemMetadata,
    },
  });

test("listRooms succeeds with the client response", async () => {
  const rooms = [
    {
      id: "room-1",
      sourceUri: "server://s/com.plexapp.plugins.library/library/metadata/1",
      title: "Room",
      type: "video",
      syncplayHost: "syncplay.example.com",
      syncplayPort: 443,
      users: [],
    },
  ];
  const client = makeStubClient({
    getWatchTogetherRooms: {
      query: mock().mockResolvedValue(rooms),
    },
  });
  const api = makeWatchTogetherApi(client);

  const result = await Effect.runPromise(api.listRooms());
  expect(result).toEqual(rooms);
});

test("rejections become WatchTogetherApiError on the error channel", async () => {
  const cause = new Error("network down");
  const client = makeStubClient({
    getWatchTogetherRooms: {
      query: mock().mockRejectedValue(cause),
    },
  });
  const api = makeWatchTogetherApi(client);

  const exit = await Effect.runPromiseExit(api.listRooms());
  expectApiError(exit, { operation: "listRooms", cause });
});

test("getItemMetadata returns the client payload when sync engine is inactive", async () => {
  const metadata = fromPartial<
    Awaited<ReturnType<WatchTogetherTrpcClient["getItemMetadata"]["query"]>>
  >({
    ratingKey: "42",
    type: "movie",
    title: "Test",
  });
  const client = makeStubClient({
    getItemMetadata: {
      query: mock().mockResolvedValue(metadata),
    },
  });
  const api = makeWatchTogetherApi(client);

  const result = await Effect.runPromise(
    api.getItemMetadata({ serverId: "haus-1", ratingKey: "42" }),
  );
  expect(result).toEqual(metadata);
});
