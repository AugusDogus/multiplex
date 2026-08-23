import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import type {
  PlexDevice,
  PlexServerClient,
  PlexTvClient,
} from "@multiplex/plex-query";
import {
  SERVER,
  createRoom,
  getServersQuery,
  makeCaller,
} from "./plex-router-test-harness";

beforeEach(() => {
  getServersQuery.mockReset();
  createRoom.mockReset();
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
  const createServerClient = mock(() => fromPartial<PlexServerClient>({}));
  const plex = fromPartial<PlexTvClient>({
    createServerClient,
    getToken: mock(() => "account-token"),
  });
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
  const plex = fromPartial<PlexTvClient>({
    createServerClient: mock(),
  });
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
  const plex = fromPartial<PlexTvClient>({
    createServerClient: mock(),
  });
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
  const serverClient = fromPartial<PlexServerClient>({ createPlayQueue });
  const createServerClient = mock((server: PlexDevice) => {
    expect(server).toBe(SERVER);
    return serverClient;
  });
  const plex = fromPartial<PlexTvClient>({
    createServerClient,
  });
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
  const plex = fromPartial<PlexTvClient>({
    createServerClient: mock(),
  });
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
  const plex = fromPartial<PlexTvClient>({
    createServerClient: mock(),
  });
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
  const serverClient = fromPartial<PlexServerClient>({
    getChannels,
    getGrid,
    reloadGuide,
    reloadAllGuides,
  });
  const plex = fromPartial<PlexTvClient>({
    createServerClient: mock(() => serverClient),
  });
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
  const serverClient = fromPartial<PlexServerClient>({
    getDVRs,
    reloadGuide,
    reloadAllGuides,
  });
  const createServerClient = mock(() => serverClient);
  const plex = fromPartial<PlexTvClient>({ createServerClient });
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
  const serverClient = fromPartial<PlexServerClient>({
    getDVRs: mock().mockResolvedValue({ MediaContainer: { Dvr: [] } }),
    reloadGuide: mock(),
    reloadAllGuides,
  });
  const plex = fromPartial<PlexTvClient>({
    createServerClient: mock(() => serverClient),
  });
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

test.each(["getDVRs", "reloadGuide", "reloadAllGuides"] as const)(
  "reloadServerGuide maps %s failures to service unavailable",
  async (failingOperation) => {
    const upstreamError = new Error(`${failingOperation} failed`);
    const hasMatchingDvr = failingOperation !== "reloadAllGuides";
    const getDVRs =
      failingOperation === "getDVRs"
        ? mock().mockRejectedValue(upstreamError)
        : mock().mockResolvedValue({
            MediaContainer: {
              Dvr: hasMatchingDvr
                ? [
                    {
                      key: "71",
                      epgIdentifier: "tv.plex.providers.epg.xmltv",
                    },
                  ]
                : [],
            },
          });
    const reloadGuide =
      failingOperation === "reloadGuide"
        ? mock().mockRejectedValue(upstreamError)
        : mock().mockResolvedValue(undefined);
    const reloadAllGuides =
      failingOperation === "reloadAllGuides"
        ? mock().mockRejectedValue(upstreamError)
        : mock().mockResolvedValue(undefined);
    const serverClient = fromPartial<PlexServerClient>({
      getDVRs,
      reloadGuide,
      reloadAllGuides,
    });
    const plex = fromPartial<PlexTvClient>({
      createServerClient: mock(() => serverClient),
    });
    getServersQuery.mockResolvedValue([SERVER]);

    const error = await catchError(
      makeCaller(plex).reloadServerGuide({
        machineIdentifier: SERVER.clientIdentifier,
        providerIdentifier: "tv.plex.providers.epg.xmltv:71",
      }),
    );

    expect(error).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Unable to refresh the Live TV guide",
      cause: upstreamError,
    });
  },
);

test("reloadServerGuide rejects unknown servers", async () => {
  const createServerClient = mock();
  const plex = fromPartial<PlexTvClient>({ createServerClient });
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
  const plex = fromPartial<PlexTvClient>({ createServerClient });
  getServersQuery.mockResolvedValue([SERVER]);

  const error = await catchError(
    makeCaller(plex).reloadServerGuide(
      fromAny({
        machineIdentifier: SERVER.clientIdentifier,
        providerIdentifier: "https://untrusted.example.test/livetv/dvrs/71",
        serverUrl: "https://untrusted.example.test",
      }),
    ),
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
