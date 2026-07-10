import { Effect, Exit, Result } from "effect";
import { expect, mock, test } from "bun:test";

import type { PlexHttpApiClient } from "./plex-api-client";
import {
  makeWatchTogetherApi,
  WatchTogetherApiError,
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

type WatchTogetherGroup = PlexHttpApiClient["watchTogether"];
type LibraryGroup = PlexHttpApiClient["library"];
type AccountGroup = PlexHttpApiClient["account"];
type PlaybackGroup = PlexHttpApiClient["playback"];

const succeed = <A>(value: A) => Effect.succeed(value);
const fail = (cause: unknown) => Effect.fail(cause);

const makeStubClient = (
  overrides: {
    watchTogether?: Partial<WatchTogetherGroup>;
    library?: Partial<LibraryGroup>;
    account?: Partial<AccountGroup>;
    playback?: Partial<PlaybackGroup>;
  } = {},
): PlexHttpApiClient =>
  ({
    watchTogether: {
      getWatchTogetherRooms: mock().mockReturnValue(succeed([])),
      getWatchTogetherRoom: mock(),
      createWatchTogetherRoom: mock(),
      inviteWatchTogetherUsers: mock(),
      deleteWatchTogetherRoom: mock().mockReturnValue(succeed(undefined)),
      getWatchTogetherInvitees: mock().mockReturnValue(succeed([])),
      ...overrides.watchTogether,
    },
    library: {
      getItemMetadata: mock(),
      getItemDetails: mock(),
      ...overrides.library,
    },
    account: {
      getUserInfo: mock(),
      getServers: mock(),
      togglePinnedSource: mock(),
      ...overrides.account,
    },
    playback: {
      createPlayQueue: mock(),
      getPlayQueue: mock(),
      sendTimeline: mock(),
      ...overrides.playback,
    },
    search: {} as PlexHttpApiClient["search"],
    liveTv: {} as PlexHttpApiClient["liveTv"],
  }) as PlexHttpApiClient;

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
    watchTogether: {
      getWatchTogetherRooms: mock().mockReturnValue(succeed(rooms)),
    },
  });
  const api = makeWatchTogetherApi(client);

  const result = await Effect.runPromise(api.listRooms());
  expect(result).toEqual(rooms);
});

test("failures become WatchTogetherApiError on the error channel", async () => {
  const cause = new Error("network down");
  const client = makeStubClient({
    watchTogether: {
      getWatchTogetherRooms: mock().mockReturnValue(fail(cause)),
    },
  });
  const api = makeWatchTogetherApi(client);

  const exit = await Effect.runPromiseExit(api.listRooms());
  expectApiError(exit, { operation: "listRooms", cause });
});

test("getRoom wraps query failures with the operation name", async () => {
  const cause = { message: "not found" };
  const client = makeStubClient({
    watchTogether: {
      getWatchTogetherRoom: mock().mockReturnValue(fail(cause)),
    },
  });
  const api = makeWatchTogetherApi(client);

  const exit = await Effect.runPromiseExit(api.getRoom("abc"));
  expectApiError(exit, { operation: "getRoom", cause });
});
