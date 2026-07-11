import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import type {
  PlexDevice,
  PlexServerClient,
  PlexTvClient,
} from "@multiplex/plex-query";
import { WatchTogetherClient } from "@multiplex/plex-query";

const getServersQuery = mock(
  (_plex: PlexTvClient): Promise<PlexDevice[]> => Promise.resolve([]),
);

await mock.module("~/server/queries/get-servers", () => ({ getServersQuery }));

const createRoom = spyOn(WatchTogetherClient.prototype, "createRoom");

const { plexRouter } = await import("./plex");

const SERVER: PlexDevice = {
  name: "Authenticated server",
  product: "Plex Media Server",
  productVersion: "1.0.0",
  platform: "Linux",
  platformVersion: "1",
  device: "PC",
  clientIdentifier: "server-1",
  createdAt: "0",
  lastSeenAt: "0",
  provides: "server",
  ownerId: null,
  sourceTitle: null,
  publicAddress: "plex.example.com",
  accessToken: "server-token",
  owned: true,
  home: false,
  synced: false,
  relay: false,
  presence: true,
  httpsRequired: true,
  publicAddressMatches: false,
  connections: [
    {
      protocol: "https",
      address: "plex.example.com",
      port: 443,
      uri: "https://plex.example.com",
      local: false,
      relay: false,
      IPv6: false,
    },
  ],
};

const AUTH_SESSION = {
  user: { id: "user-1", plexAuthToken: "account-token" },
  session: { id: "session-1" },
};

beforeEach(() => {
  getServersQuery.mockReset();
  createRoom.mockReset();
});

const makeCaller = (
  plex: PlexTvClient | null,
  authSession: typeof AUTH_SESSION | null = AUTH_SESSION,
) =>
  plexRouter.createCaller({
    authSession,
    plex,
    db: {},
    headers: new Headers(),
  } as never);

const catchError = async (operation: Promise<unknown>) => {
  try {
    await operation;
  } catch (error) {
    return error;
  }

  throw new Error("Expected operation to reject");
};

test("createWatchTogetherRoom resolves the server before creating the room", async () => {
  const createdRoom = {
    id: "room-1",
    sourceUri:
      "server://server-1/com.plexapp.plugins.library/library/metadata/20",
    title: "Movie night",
    type: "video",
    syncplayHost: "syncplay.plex.tv",
    syncplayPort: 443,
    users: [],
  };
  const createServerClient = mock(() => ({}) as PlexServerClient);
  const plex = {
    createServerClient,
    getToken: mock(() => "account-token"),
  } as unknown as PlexTvClient;
  getServersQuery.mockResolvedValue([SERVER]);
  createRoom.mockResolvedValue(createdRoom);

  const result = await makeCaller(plex).createWatchTogetherRoom({
    serverId: SERVER.clientIdentifier,
    ratingKey: "20",
    key: "/library/metadata/20",
    title: "Movie night",
    users: [2],
  });

  expect(result).toEqual(createdRoom);
  expect(getServersQuery).toHaveBeenCalledWith(plex);
  expect(createServerClient).toHaveBeenCalledWith(SERVER);
  expect(createRoom).toHaveBeenCalledWith({
    sourceUri:
      "server://server-1/com.plexapp.plugins.library/library/metadata/20",
    title: "Movie night",
    users: [2],
  });
});

test("createWatchTogetherRoom rejects unknown server IDs", async () => {
  const plex = {
    createServerClient: mock(),
  } as unknown as PlexTvClient;
  getServersQuery.mockResolvedValue([SERVER]);

  const error = await catchError(
    makeCaller(plex).createWatchTogetherRoom({
      serverId: "unknown-server",
      ratingKey: "20",
      title: "Movie night",
      users: [],
    }),
  );

  expect(error).toMatchObject({ code: "NOT_FOUND" });
  expect(createRoom).not.toHaveBeenCalled();
});

test("createWatchTogetherRoom rejects unavailable authenticated servers", async () => {
  const plex = {
    createServerClient: mock(),
  } as unknown as PlexTvClient;
  getServersQuery.mockResolvedValue([{ ...SERVER, presence: false }]);

  const error = await catchError(
    makeCaller(plex).createWatchTogetherRoom({
      serverId: SERVER.clientIdentifier,
      ratingKey: "20",
      title: "Movie night",
      users: [],
    }),
  );

  expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  expect(createRoom).not.toHaveBeenCalled();
});

test("createPlayQueue resolves the server and constructs the Plex URI", async () => {
  const createdQueue = { MediaContainer: { playQueueID: 10 } };
  const createPlayQueue = mock().mockResolvedValue(createdQueue);
  const serverClient = { createPlayQueue } as unknown as PlexServerClient;
  const createServerClient = mock((server: PlexDevice) => {
    expect(server).toBe(SERVER);
    return serverClient;
  });
  const plex = {
    createServerClient,
  } as unknown as PlexTvClient;
  getServersQuery.mockResolvedValue([SERVER]);

  const result = await makeCaller(plex).createPlayQueue({
    serverId: SERVER.clientIdentifier,
    type: "video",
    ratingKey: "20",
    key: "/library/metadata/20",
  });

  expect(result).toEqual(createdQueue);
  expect(getServersQuery).toHaveBeenCalledWith(plex);
  expect(createServerClient).toHaveBeenCalledTimes(1);
  expect(createPlayQueue).toHaveBeenCalledWith({
    type: "video",
    uri: "server://server-1/com.plexapp.plugins.library/library/metadata/20",
    continuous: true,
    includeMarkers: true,
    includeChapters: true,
    shuffle: false,
    repeat: 0,
  });
});

test("server procedures reject unknown server IDs", async () => {
  const plex = {
    createServerClient: mock(),
  } as unknown as PlexTvClient;
  getServersQuery.mockResolvedValue([SERVER]);

  const error = await catchError(
    makeCaller(plex).getItemMetadata({
      serverId: "unknown-server",
      ratingKey: "20",
    }),
  );

  expect(error).toMatchObject({ code: "NOT_FOUND" });
});

test("server procedures reject unavailable authenticated servers", async () => {
  const plex = {
    createServerClient: mock(),
  } as unknown as PlexTvClient;
  getServersQuery.mockResolvedValue([{ ...SERVER, presence: false }]);

  const error = await catchError(
    makeCaller(plex).getItemMetadata({
      serverId: SERVER.clientIdentifier,
      ratingKey: "20",
    }),
  );

  expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
});

test("protected Plex procedures reject unauthenticated callers", async () => {
  const error = await catchError(makeCaller(null, null).getServers());

  expect(error).toMatchObject({
    code: "UNAUTHORIZED",
  });
});

test("protected Plex procedures reject sessions without a Plex token", async () => {
  const error = await catchError(makeCaller(null).getServers());

  expect(error).toMatchObject({
    code: "UNAUTHORIZED",
    message: "Plex authentication required. Please sign in with Plex again.",
  });
});
