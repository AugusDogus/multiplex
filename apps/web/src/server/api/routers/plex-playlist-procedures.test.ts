import { beforeEach, expect, mock, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import type { PlexTvClient } from "@multiplex/plex-query";
import { PlexAPIError } from "@multiplex/plex-query";
import {
  SERVER,
  getServersQuery,
  makeCaller,
} from "./plex-router-test-harness";

beforeEach(() => {
  getServersQuery.mockReset();
});

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
  const plex = fromPartial<PlexTvClient>({
    getToken: () => "MASTER_TOKEN_SENTINEL",
    createServerClient: mock(() => serverClient),
  });
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
  const plex = fromPartial<PlexTvClient>({ createServerClient: mock() });
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

  const missing = makePlaylistCaller({
    getPlaylist: mock().mockRejectedValue(new PlexAPIError("Not Found", 404)),
  });
  const missingError = await catchError(
    missing.caller.getPlaylist({
      serverId: SERVER.clientIdentifier,
      playlistRatingKey: "42",
    }),
  );
  expect(missingError).toMatchObject({ code: "NOT_FOUND" });
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

test("rename maps Plex failures to stable tRPC errors", async () => {
  for (const [failure, expected] of [
    [
      new PlexAPIError("Gone", 404),
      { code: "NOT_FOUND", message: "Playlist not found" },
    ],
    [
      new PlexAPIError("Duplicate", 409),
      {
        code: "CONFLICT",
        message: "A playlist with this name already exists",
      },
    ],
    [
      new Error("offline"),
      { code: "SERVICE_UNAVAILABLE", message: "Unable to rename playlist" },
    ],
  ] as const) {
    const { caller } = makePlaylistCaller({
      renamePlaylist: mock().mockRejectedValue(failure),
    });
    const error = await catchError(
      caller.renamePlaylist({
        serverId: SERVER.clientIdentifier,
        playlistRatingKey: "42",
        title: "New name",
      }),
    );

    expect(error).toMatchObject(expected);
  }
});

test("playlist writes map stale and unavailable Plex failures", async () => {
  const deleted = makePlaylistCaller({
    deletePlaylist: mock().mockRejectedValue(new PlexAPIError("Gone", 404)),
  });
  expect(
    await catchError(
      deleted.caller.deletePlaylist({
        serverId: SERVER.clientIdentifier,
        playlistRatingKey: "42",
      }),
    ),
  ).toMatchObject({ code: "NOT_FOUND", message: "Playlist not found" });

  const moved = makePlaylistCaller({
    movePlaylistItem: mock().mockRejectedValue(
      new PlexAPIError("Changed", 409),
    ),
  });
  expect(
    await catchError(
      moved.caller.movePlaylistItem({
        serverId: SERVER.clientIdentifier,
        playlistRatingKey: "42",
        playlistItemId: 7002,
        direction: "down",
      }),
    ),
  ).toMatchObject({
    code: "CONFLICT",
    message: "The playlist changed before it could be reordered",
  });

  const added = makePlaylistCaller({
    addItemToPlaylist: mock().mockRejectedValue(new Error("offline")),
  });
  expect(
    await catchError(
      added.caller.addItemToPlaylist({
        serverId: SERVER.clientIdentifier,
        playlistRatingKey: "42",
        ratingKey: "100",
        key: "/library/metadata/100",
      }),
    ),
  ).toMatchObject({
    code: "SERVICE_UNAVAILABLE",
    message: "Unable to add item to playlist",
  });

  const created = makePlaylistCaller({
    createPlaylist: mock().mockRejectedValue(
      new PlexAPIError("Duplicate", 409),
    ),
  });
  expect(
    await catchError(
      created.caller.createPlaylistWithItem({
        serverId: SERVER.clientIdentifier,
        title: "Road trip",
        type: "audio",
        ratingKey: "100",
        key: "/library/metadata/100",
      }),
    ),
  ).toMatchObject({
    code: "CONFLICT",
    message: "A playlist with this name already exists",
  });
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

test("reorder loads every page when Plex omits the playlist item count", async () => {
  const getPlaylistContents = mock()
    .mockResolvedValueOnce({
      MediaContainer: {
        size: 2,
        offset: 0,
        Metadata: PLAYLIST_ITEMS.slice(0, 2),
      },
    })
    .mockResolvedValueOnce({
      MediaContainer: {
        size: 1,
        totalSize: 3,
        offset: 2,
        Metadata: PLAYLIST_ITEMS.slice(2),
      },
    });
  const { caller, serverClient } = makePlaylistCaller({
    getPlaylist: mock().mockResolvedValue({
      ...PLAYLIST,
      leafCount: undefined,
    }),
    getPlaylistContents,
  });

  await caller.movePlaylistItem({
    serverId: SERVER.clientIdentifier,
    playlistRatingKey: "42",
    playlistItemId: 7003,
    direction: "up",
  });

  expect(getPlaylistContents).toHaveBeenNthCalledWith(1, "42", {
    start: 0,
    size: 500,
  });
  expect(getPlaylistContents).toHaveBeenNthCalledWith(2, "42", {
    start: 2,
    size: 500,
  });
  expect(serverClient.movePlaylistItem).toHaveBeenCalledWith("42", 7003, 7001);
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

test("playlist mutations classify collections by subtype", async () => {
  const { caller, serverClient } = makePlaylistCaller({
    getItemMetadata: mock().mockResolvedValue({
      ratingKey: "100",
      key: "/library/collections/100/children",
      type: "collection",
      subtype: "artist",
      title: "Favorite artists",
    }),
  });

  await caller.addItemToPlaylist({
    serverId: SERVER.clientIdentifier,
    playlistRatingKey: "42",
    ratingKey: "100",
    key: "/library/collections/100/children",
  });
  await caller.createPlaylistWithItem({
    serverId: SERVER.clientIdentifier,
    title: "Artist collections",
    type: "audio",
    ratingKey: "100",
    key: "/library/collections/100/children",
  });

  expect(serverClient.addItemToPlaylist).toHaveBeenCalledTimes(1);
  expect(serverClient.createPlaylist).toHaveBeenCalledWith({
    title: "Artist collections",
    type: "audio",
    uri: "server://server-1/com.plexapp.plugins.library/library/collections/100/children",
  });
});

test("playlist mutations accept canonical metadata children keys", async () => {
  const videoPlaylist = { ...PLAYLIST, playlistType: "video" };
  const { caller, serverClient } = makePlaylistCaller({
    getPlaylist: mock().mockResolvedValue(videoPlaylist),
    getItemMetadata: mock().mockResolvedValue({
      ratingKey: "200",
      key: "/library/metadata/200/children",
      type: "show",
      title: "A show",
    }),
  });

  await caller.addItemToPlaylist({
    serverId: SERVER.clientIdentifier,
    playlistRatingKey: "42",
    ratingKey: "200",
    key: "/library/metadata/200/children",
  });

  expect(serverClient.addItemToPlaylist).toHaveBeenCalledWith(
    "42",
    "server://server-1/com.plexapp.plugins.library/library/metadata/200/children",
  );
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
