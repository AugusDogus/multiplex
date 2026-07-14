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

test("guide reads return an empty lineup without reloads or timers", async () => {
  const getChannels = mock().mockResolvedValue({
    MediaContainer: {
      Channel: [
        {
          id: "channel-1",
          gridKey: "grid-1",
          vcn: "1",
          thumb: "",
          title: "Channel 1",
          callSign: "ONE",
        },
      ],
    },
  });
  const getGrid = mock().mockResolvedValue({
    MediaContainer: { Metadata: [] },
  });
  const reloadGuide = mock();
  const reloadAllGuides = mock();
  const serverClient = {
    getChannels,
    getGrid,
    reloadGuide,
    reloadAllGuides,
  } as unknown as PlexServerClient;
  const plex = {
    createServerClient: mock(() => serverClient),
  } as unknown as PlexTvClient;
  const timeoutSpy = spyOn(globalThis, "setTimeout");
  getServersQuery.mockResolvedValue([SERVER]);

  try {
    const result = await makeCaller(plex).getServerChannelsProgramming({
      machineIdentifier: SERVER.clientIdentifier,
      providerIdentifier: "tv.plex.providers.epg.xmltv:71",
      date: "2026-07-14",
    });

    expect(result).toEqual([
      {
        channel: {
          id: "channel-1",
          gridKey: "grid-1",
          vcn: "1",
          thumb: "",
          title: "Channel 1",
          callSign: "ONE",
        },
        programs: [],
      },
    ]);
    expect(getChannels).toHaveBeenCalledTimes(1);
    expect(getGrid).toHaveBeenCalledTimes(1);
    expect(reloadGuide).not.toHaveBeenCalled();
    expect(reloadAllGuides).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
  } finally {
    timeoutSpy.mockRestore();
  }
});

test("reloadServerGuide reloads the DVR matching the authorized provider", async () => {
  const getDVRs = mock().mockResolvedValue({
    MediaContainer: {
      Dvr: [
        {
          key: "71",
          epgIdentifier: "tv.plex.providers.epg.xmltv",
        },
      ],
    },
  });
  const reloadGuide = mock().mockResolvedValue(undefined);
  const reloadAllGuides = mock().mockResolvedValue(undefined);
  const serverClient = {
    getDVRs,
    reloadGuide,
    reloadAllGuides,
  } as unknown as PlexServerClient;
  const createServerClient = mock(() => serverClient);
  const plex = { createServerClient } as unknown as PlexTvClient;
  getServersQuery.mockResolvedValue([SERVER]);

  const result = await makeCaller(plex).reloadServerGuide({
    machineIdentifier: SERVER.clientIdentifier,
    providerIdentifier: "tv.plex.providers.epg.xmltv:71",
  });

  expect(result).toEqual({
    scope: "provider",
    message: "Guide refresh requested for this Live TV provider.",
  });
  expect(createServerClient).toHaveBeenCalledTimes(1);
  expect(createServerClient).toHaveBeenCalledWith(SERVER);
  expect(getDVRs).toHaveBeenCalledTimes(1);
  expect(reloadGuide).toHaveBeenCalledTimes(1);
  expect(reloadGuide).toHaveBeenCalledWith("71");
  expect(reloadAllGuides).not.toHaveBeenCalled();
});

test("reloadServerGuide documents its all-guides fallback", async () => {
  const reloadAllGuides = mock().mockResolvedValue(undefined);
  const serverClient = {
    getDVRs: mock().mockResolvedValue({ MediaContainer: { Dvr: [] } }),
    reloadGuide: mock(),
    reloadAllGuides,
  } as unknown as PlexServerClient;
  const plex = {
    createServerClient: mock(() => serverClient),
  } as unknown as PlexTvClient;
  getServersQuery.mockResolvedValue([SERVER]);

  const result = await makeCaller(plex).reloadServerGuide({
    machineIdentifier: SERVER.clientIdentifier,
    providerIdentifier: "tv.plex.providers.epg.xmltv:71",
  });

  expect(result).toEqual({
    scope: "all",
    message:
      "This server did not expose a matching DVR, so all Live TV guides were refreshed.",
  });
  expect(reloadAllGuides).toHaveBeenCalledTimes(1);
});

test("reloadServerGuide rejects unknown servers", async () => {
  const createServerClient = mock();
  const plex = { createServerClient } as unknown as PlexTvClient;
  getServersQuery.mockResolvedValue([SERVER]);

  const error = await catchError(
    makeCaller(plex).reloadServerGuide({
      machineIdentifier: "unknown-server",
      providerIdentifier: "tv.plex.providers.epg.xmltv:71",
    }),
  );

  expect(error).toMatchObject({ code: "NOT_FOUND" });
  expect(createServerClient).not.toHaveBeenCalled();
});

test("reloadServerGuide rejects client-supplied URLs", async () => {
  const createServerClient = mock();
  const plex = { createServerClient } as unknown as PlexTvClient;
  getServersQuery.mockResolvedValue([SERVER]);

  const error = await catchError(
    makeCaller(plex).reloadServerGuide({
      machineIdentifier: SERVER.clientIdentifier,
      providerIdentifier: "https://untrusted.example.test/livetv/dvrs/71",
      serverUrl: "https://untrusted.example.test",
    } as never),
  );

  expect(error).toMatchObject({ code: "BAD_REQUEST" });
  expect(createServerClient).not.toHaveBeenCalled();
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
