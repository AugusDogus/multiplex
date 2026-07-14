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

const PLAYLIST = {
  ratingKey: "42",
  key: "/playlists/42/items",
  type: "playlist",
  title: "Road trip",
  smart: false,
  playlistType: "audio",
  leafCount: 3,
};

const PLAYLIST_ITEMS = [
  {
    ratingKey: "100",
    key: "/library/metadata/100",
    type: "track",
    title: "One",
    playlistItemID: 7001,
  },
  {
    ratingKey: "101",
    key: "/library/metadata/101",
    type: "track",
    title: "Two",
    playlistItemID: 7002,
  },
  {
    ratingKey: "102",
    key: "/library/metadata/102",
    type: "track",
    title: "Three",
    playlistItemID: 7003,
  },
];

function makePlaylistCaller(
  overrides: Partial<{
    getPlaylist: ReturnType<typeof mock>;
    getPlaylistProviderAccess: ReturnType<typeof mock>;
    getPlaylistContents: ReturnType<typeof mock>;
    renamePlaylist: ReturnType<typeof mock>;
    deletePlaylist: ReturnType<typeof mock>;
    movePlaylistItem: ReturnType<typeof mock>;
    getItemMetadata: ReturnType<typeof mock>;
    addItemToPlaylist: ReturnType<typeof mock>;
    createPlaylist: ReturnType<typeof mock>;
  }> = {},
) {
  const serverClient = {
    getPlaylist: mock().mockResolvedValue(PLAYLIST),
    getPlaylistProviderAccess: mock().mockResolvedValue({
      supported: true,
      readOnly: false,
    }),
    getPlaylistContents: mock().mockResolvedValue({
      MediaContainer: {
        size: 3,
        totalSize: 3,
        offset: 0,
        Metadata: PLAYLIST_ITEMS,
      },
    }),
    renamePlaylist: mock().mockResolvedValue(undefined),
    deletePlaylist: mock().mockResolvedValue(undefined),
    movePlaylistItem: mock().mockResolvedValue({ MediaContainer: {} }),
    getItemMetadata: mock().mockResolvedValue({
      ratingKey: "100",
      key: "/library/metadata/100",
      type: "track",
      title: "One",
    }),
    addItemToPlaylist: mock().mockResolvedValue({
      MediaContainer: { leafCountAdded: 1 },
    }),
    createPlaylist: mock().mockResolvedValue({
      MediaContainer: { Metadata: [PLAYLIST] },
    }),
    ...overrides,
  };
  const plex = {
    getToken: () => "MASTER_TOKEN_SENTINEL",
    createServerClient: mock(() => serverClient),
  } as unknown as PlexTvClient;
  getServersQuery.mockResolvedValue([SERVER]);

  return { caller: makeCaller(plex), serverClient };
}

test("playlist detail and contents are explicit credential-free DTOs", async () => {
  const playlistWithSentinels = {
    ...PLAYLIST,
    authToken: "MASTER_TOKEN_SENTINEL",
    serverUrl: "https://private.example.test",
    content: "library://private/rules",
  };
  const itemWithSentinels = {
    ...PLAYLIST_ITEMS[0]!,
    authToken: "MASTER_TOKEN_SENTINEL",
    serverUrl: "https://private.example.test",
  };
  const { caller } = makePlaylistCaller({
    getPlaylist: mock().mockResolvedValue(playlistWithSentinels),
    getPlaylistContents: mock().mockResolvedValue({
      MediaContainer: {
        size: 1,
        Metadata: [itemWithSentinels],
      },
    }),
  });

  const [detail, contents] = await Promise.all([
    caller.getPlaylist({
      serverId: SERVER.clientIdentifier,
      playlistRatingKey: "42",
    }),
    caller.getPlaylistContents({
      serverId: SERVER.clientIdentifier,
      playlistRatingKey: "42",
      start: 0,
      size: 100,
    }),
  ]);

  expect(detail).toEqual({
    ratingKey: "42",
    title: "Road trip",
    type: "playlist",
    smart: false,
    playlistType: "audio",
    leafCount: 3,
    readOnly: false,
  });
  expect(contents.items).toEqual([PLAYLIST_ITEMS[0]!]);
  expect(JSON.stringify({ detail, contents })).not.toContain(
    "MASTER_TOKEN_SENTINEL",
  );
  expect(JSON.stringify({ detail, contents })).not.toContain(
    "private.example.test",
  );
  expect(JSON.stringify(detail)).not.toContain("library://private/rules");
});

test("playlist queries reject unknown servers and mismatched playlist ids", async () => {
  const plex = { createServerClient: mock() } as unknown as PlexTvClient;
  getServersQuery.mockResolvedValue([SERVER]);
  const unknownError = await catchError(
    makeCaller(plex).getPlaylist({
      serverId: "missing",
      playlistRatingKey: "42",
    }),
  );
  expect(unknownError).toMatchObject({ code: "NOT_FOUND" });

  const { caller } = makePlaylistCaller({
    getPlaylist: mock().mockResolvedValue({ ...PLAYLIST, ratingKey: "43" }),
  });
  const mismatchError = await catchError(
    caller.getPlaylist({
      serverId: SERVER.clientIdentifier,
      playlistRatingKey: "42",
    }),
  );
  expect(mismatchError).toMatchObject({ code: "BAD_GATEWAY" });
});

test("rename trims titles and delete reauthorizes the dumb editable playlist", async () => {
  const { caller, serverClient } = makePlaylistCaller();

  await caller.renamePlaylist({
    serverId: SERVER.clientIdentifier,
    playlistRatingKey: "42",
    title: "  New name  ",
  });
  await caller.deletePlaylist({
    serverId: SERVER.clientIdentifier,
    playlistRatingKey: "42",
  });

  expect(serverClient.getPlaylist).toHaveBeenCalledTimes(2);
  expect(serverClient.getPlaylistProviderAccess).toHaveBeenCalledTimes(2);
  expect(serverClient.renamePlaylist).toHaveBeenCalledWith("42", "New name");
  expect(serverClient.deletePlaylist).toHaveBeenCalledWith("42");

  const validationError = await catchError(
    caller.renamePlaylist({
      serverId: SERVER.clientIdentifier,
      playlistRatingKey: "42",
      title: "   ",
    }),
  );
  expect(validationError).toMatchObject({ code: "BAD_REQUEST" });
});

test("all playlist mutations reject smart and provider-readonly playlists", async () => {
  const smart = makePlaylistCaller({
    getPlaylist: mock().mockResolvedValue({ ...PLAYLIST, smart: true }),
  });
  const smartError = await catchError(
    smart.caller.deletePlaylist({
      serverId: SERVER.clientIdentifier,
      playlistRatingKey: "42",
    }),
  );
  expect(smartError).toMatchObject({ code: "BAD_REQUEST" });
  expect(smart.serverClient.deletePlaylist).not.toHaveBeenCalled();

  const readOnly = makePlaylistCaller({
    getPlaylistProviderAccess: mock().mockResolvedValue({
      supported: true,
      readOnly: true,
    }),
  });
  const readOnlyError = await catchError(
    readOnly.caller.renamePlaylist({
      serverId: SERVER.clientIdentifier,
      playlistRatingKey: "42",
      title: "Nope",
    }),
  );
  expect(readOnlyError).toMatchObject({ code: "FORBIDDEN" });
  expect(readOnly.serverClient.renamePlaylist).not.toHaveBeenCalled();
});

test("reorder validates membership and uses playlist item ids", async () => {
  const { caller, serverClient } = makePlaylistCaller();

  await caller.movePlaylistItem({
    serverId: SERVER.clientIdentifier,
    playlistRatingKey: "42",
    playlistItemId: 7002,
    direction: "up",
  });
  await caller.movePlaylistItem({
    serverId: SERVER.clientIdentifier,
    playlistRatingKey: "42",
    playlistItemId: 7002,
    direction: "down",
  });

  expect(serverClient.movePlaylistItem).toHaveBeenNthCalledWith(
    1,
    "42",
    7002,
    undefined,
  );
  expect(serverClient.movePlaylistItem).toHaveBeenNthCalledWith(
    2,
    "42",
    7002,
    7003,
  );

  const missingError = await catchError(
    caller.movePlaylistItem({
      serverId: SERVER.clientIdentifier,
      playlistRatingKey: "42",
      playlistItemId: 9999,
      direction: "up",
    }),
  );
  expect(missingError).toMatchObject({ code: "BAD_REQUEST" });

  const firstError = await catchError(
    caller.movePlaylistItem({
      serverId: SERVER.clientIdentifier,
      playlistRatingKey: "42",
      playlistItemId: 7001,
      direction: "up",
    }),
  );
  const lastError = await catchError(
    caller.movePlaylistItem({
      serverId: SERVER.clientIdentifier,
      playlistRatingKey: "42",
      playlistItemId: 7003,
      direction: "down",
    }),
  );
  expect(firstError).toMatchObject({ code: "BAD_REQUEST" });
  expect(lastError).toMatchObject({ code: "BAD_REQUEST" });
  expect(serverClient.movePlaylistItem).toHaveBeenCalledTimes(2);
});

test("playlist upstream errors are stable and credential-free", async () => {
  const sentinel = "MASTER_TOKEN_SENTINEL_DO_NOT_SERIALIZE";
  const { caller } = makePlaylistCaller({
    getPlaylistContents: mock().mockRejectedValue(
      new Error(`PMS failed with X-Plex-Token=${sentinel}`),
    ),
  });
  const error = await catchError(
    caller.getPlaylistContents({
      serverId: SERVER.clientIdentifier,
      playlistRatingKey: "42",
      start: 0,
      size: 100,
    }),
  );

  expect(error).toMatchObject({
    code: "SERVICE_UNAVAILABLE",
    message: "Unable to load playlist contents",
  });
  expect(JSON.stringify(error)).not.toContain(sentinel);
});

test("add revalidates playlist type and media item before append", async () => {
  const { caller, serverClient } = makePlaylistCaller({
    getItemMetadata: mock().mockResolvedValue({
      ratingKey: "100",
      key: "/library/metadata/100",
      type: "movie",
      title: "Wrong bucket",
    }),
  });
  const error = await catchError(
    caller.addItemToPlaylist({
      serverId: SERVER.clientIdentifier,
      playlistRatingKey: "42",
      ratingKey: "100",
      key: "/library/metadata/100",
    }),
  );

  expect(error).toMatchObject({ code: "BAD_REQUEST" });
  expect(serverClient.addItemToPlaylist).not.toHaveBeenCalled();
});

test("add and create preserve validated direct-PMS item URIs", async () => {
  const { caller, serverClient } = makePlaylistCaller();

  const addResult = await caller.addItemToPlaylist({
    serverId: SERVER.clientIdentifier,
    playlistRatingKey: "42",
    ratingKey: "100",
    key: "/library/metadata/100",
  });
  const createResult = await caller.createPlaylistWithItem({
    serverId: SERVER.clientIdentifier,
    title: "New mix",
    type: "audio",
    ratingKey: "100",
    key: "/library/metadata/100",
  });

  expect(addResult).toEqual({ leafCountAdded: 1 });
  expect(serverClient.addItemToPlaylist).toHaveBeenCalledWith(
    "42",
    "server://server-1/com.plexapp.plugins.library/library/metadata/100",
  );
  expect(serverClient.createPlaylist).toHaveBeenCalledWith({
    title: "New mix",
    type: "audio",
    uri: "server://server-1/com.plexapp.plugins.library/library/metadata/100",
  });
  expect(createResult).toEqual({ ratingKey: "42", title: "Road trip" });
});

test("create rejects providers that do not advertise editable playlists", async () => {
  const { caller, serverClient } = makePlaylistCaller({
    getPlaylistProviderAccess: mock().mockResolvedValue({
      supported: false,
      readOnly: false,
    }),
  });

  const error = await catchError(
    caller.createPlaylistWithItem({
      serverId: SERVER.clientIdentifier,
      title: "Nope",
      type: "audio",
      ratingKey: "100",
      key: "/library/metadata/100",
    }),
  );

  expect(error).toMatchObject({ code: "FORBIDDEN" });
  expect(serverClient.createPlaylist).not.toHaveBeenCalled();
});

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
