import { Effect, Exit, Result } from "effect";
import { expect, test, vi } from "vitest";

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
  ({
    getWatchTogetherRooms: {
      query: vi.fn().mockResolvedValue([]),
      ...overrides.getWatchTogetherRooms,
    },
    getWatchTogetherRoom: {
      query: vi.fn(),
      ...overrides.getWatchTogetherRoom,
    },
    createWatchTogetherRoom: {
      mutate: vi.fn(),
      ...overrides.createWatchTogetherRoom,
    },
    deleteWatchTogetherRoom: {
      mutate: vi.fn().mockResolvedValue(undefined),
      ...overrides.deleteWatchTogetherRoom,
    },
    getItemMetadata: {
      query: vi.fn(),
      ...overrides.getItemMetadata,
    },
    getUserInfo: {
      query: vi.fn(),
      ...overrides.getUserInfo,
    },
    createPlayQueue: {
      mutate: vi.fn(),
      ...overrides.createPlayQueue,
    },
    getPlayQueue: {
      query: vi.fn(),
      ...overrides.getPlayQueue,
    },
  }) as WatchTogetherTrpcClient;

test("listRooms succeeds with the client response", async () => {
  const rooms = [{ id: "room-1" }];
  const client = makeStubClient({
    getWatchTogetherRooms: {
      query: vi.fn().mockResolvedValue(rooms),
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
      query: vi.fn().mockRejectedValue(cause),
    },
  });
  const api = makeWatchTogetherApi(client);

  const exit = await Effect.runPromiseExit(api.listRooms());
  expectApiError(exit, { operation: "listRooms", cause });
});

test("getRoom wraps query failures with the operation name", async () => {
  const cause = { message: "not found" };
  const client = makeStubClient({
    getWatchTogetherRoom: {
      query: vi.fn().mockRejectedValue(cause),
    },
  });
  const api = makeWatchTogetherApi(client);

  const exit = await Effect.runPromiseExit(api.getRoom("abc"));
  expectApiError(exit, { operation: "getRoom", cause });
});
