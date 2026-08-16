import { describe, expect, mock, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import type {
  ItemMetadata,
  PlexServerClient,
  PlexTvClient,
  WatchTogetherRoom,
} from "@multiplex/plex-query";

import type { GuestAccessResolution, ResolveGuestAccess } from "./guest-access";
import {
  createGuestBootstrapService,
  createGuestContinuationService,
} from "./guest-bootstrap";
import { createGuestCapabilityCodec } from "./guest-capability";

const ROOM: WatchTogetherRoom = {
  id: "Room123",
  sourceUri:
    "server://server-1/com.plexapp.plugins.library/library/metadata/42",
  title: "Movie",
  type: "video",
  syncplayHost: "syncplay.example.com",
  syncplayPort: 443,
  users: [
    { id: 1, title: "Host" },
    { id: 2, title: "Guest" },
  ],
};

const ITEM = fromPartial<ItemMetadata>({
  ratingKey: "42",
  key: "/library/metadata/42",
  title: "Movie",
  type: "movie",
  Media: [{ Part: [{ key: "/library/parts/42/file.mp4" }] }],
});

async function makeCapability(options?: { expired?: boolean }) {
  return createGuestCapabilityCodec("test-secret").sign({
    hostUserId: "host-app-user",
    roomId: ROOM.id,
    ...(options?.expired
      ? {
          now: new Date("2020-01-01T00:00:00.000Z"),
          lifetimeSeconds: 1,
        }
      : {}),
  });
}

function makeService(options?: {
  room?: WatchTogetherRoom;
  roomFails?: boolean;
}) {
  const issueTransientToken = mock(async () => "transient-guest-token");
  const serverClient = fromPartial<PlexServerClient>({
    issueTransientToken,
    createPlayQueue: mock(async () => ({
      MediaContainer: {
        playQueueID: 1,
        Metadata: [
          {
            ratingKey: "42",
            key: "/library/metadata/42",
            guid: "plex://episode/42",
            type: "episode",
            title: "Current",
            index: 1,
            parentIndex: 1,
          },
          {
            ratingKey: "43",
            key: "/library/metadata/43",
            guid: "plex://episode/43",
            type: "episode",
            title: "Next",
            index: 2,
            parentIndex: 1,
          },
        ],
      },
    })),
  });
  const hostPlex = fromPartial<PlexTvClient>({});
  const resolveAccess: ResolveGuestAccess = mock(
    async (): Promise<GuestAccessResolution> => ({
      ok: true,
      value: {
        hostPlexUserId: 1,
        guest: {
          id: 2,
          uuid: "guest-uuid",
          title: "Guest",
          admin: false,
          guest: true,
          protected: false,
          restricted: true,
        },
        playbackServerClient: serverClient,
        playbackServerUrl: "https://example.plex.direct",
        item: { ...ITEM, streamPartKey: "/library/parts/42/file.mp4" },
      },
    }),
  );

  const service = createGuestBootstrapService({
    capabilityCodec: createGuestCapabilityCodec("test-secret"),
    loadHostToken: mock(async () => "host-account-token"),
    createPlexClient: mock(() => hostPlex),
    createWatchTogetherClient: mock(() => ({
      getRoom: options?.roomFails
        ? mock(async () => {
            throw new Error("deleted room");
          })
        : mock(async () => options?.room ?? ROOM),
    })),
    resolveAccess,
  });

  return { issueTransientToken, resolveAccess, service };
}

describe("guest bootstrap", () => {
  test("returns only the transient credential after validating the live room", async () => {
    const { issueTransientToken, service } = makeService();

    const result = await service(await makeCapability());

    expect(result).toMatchObject({
      ok: true,
      value: {
        room: { id: ROOM.id, sourceUri: ROOM.sourceUri },
        host: { id: 1, title: "Host" },
        guest: { id: 2, title: "Guest" },
        serverId: "server-1",
        serverUrl: "https://example.plex.direct",
        authToken: "transient-guest-token",
        item: { ratingKey: "42" },
        nextEpisode: { ratingKey: "43", title: "Next" },
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("host-account-token");
    expect(serialized).not.toContain("durable-guest-token");
    expect(serialized).not.toContain("switched-guest-token");
    expect(issueTransientToken).toHaveBeenCalledTimes(1);
  });

  test("discovers the live successor when guest queue lookup found no next episode", async () => {
    const nextRoom: WatchTogetherRoom = {
      ...ROOM,
      id: "Room456",
      sourceUri: ROOM.sourceUri.replace("/42", "/43"),
      title: "Next",
      updatedAt: Math.floor(Date.now() / 1000),
    };
    const issueTransientToken = mock(async () => "next-transient-token");
    const serverClient = fromPartial<PlexServerClient>({
      issueTransientToken,
      createPlayQueue: mock(async () => ({
        MediaContainer: { playQueueID: 2, Metadata: [] },
      })),
    });
    const resolveAccess: ResolveGuestAccess = mock(
      async (
        _host: PlexTvClient,
        input: { ratingKey: string },
      ): Promise<GuestAccessResolution> => ({
        ok: true,
        value: {
          hostPlexUserId: 1,
          guest: {
            id: 2,
            uuid: "guest-uuid",
            title: "Guest",
            admin: false,
            guest: true,
            protected: false,
            restricted: true,
          },
          playbackServerClient: serverClient,
          playbackServerUrl: "https://example.plex.direct",
          item: {
            ...ITEM,
            ratingKey: input.ratingKey,
            key: `/library/metadata/${input.ratingKey}`,
            streamPartKey: `/library/parts/${input.ratingKey}/file.mp4`,
          },
        },
      }),
    );
    const codec = createGuestCapabilityCodec("test-secret");
    const deleteRoom = mock(async () => undefined);
    const service = createGuestContinuationService({
      capabilityCodec: codec,
      loadHostToken: mock(async () => "host-account-token"),
      createPlexClient: mock(() => fromPartial<PlexTvClient>({})),
      createWatchTogetherClient: mock(() => ({
        deleteRoom,
        getRoom: mock(async () => ROOM),
        listRooms: mock(async () => [ROOM, nextRoom]),
      })),
      resolveAccess,
    });

    const result = await service(await makeCapability());

    expect(result).toMatchObject({
      ok: true,
      value: {
        room: { id: nextRoom.id },
        item: { ratingKey: "43" },
        authToken: "next-transient-token",
      },
    });
    expect(result.ok).toBe(true);
    const successor = result.ok
      ? await codec.verify(result.capability)
      : { ok: false as const };
    expect(successor).toMatchObject({
      ok: true,
      payload: { roomId: nextRoom.id },
    });
    expect(issueTransientToken).toHaveBeenCalledTimes(1);
    expect(resolveAccess).toHaveBeenCalledWith(expect.anything(), {
      serverId: "server-1",
      ratingKey: "43",
    });
    expect(deleteRoom).toHaveBeenCalledWith(ROOM.id);
  });

  test("does not mint after the host deleted the Plex room", async () => {
    const { issueTransientToken, service } = makeService({ roomFails: true });

    expect(await service(await makeCapability())).toEqual({
      ok: false,
      reason: "room-unavailable",
    });
    expect(issueTransientToken).not.toHaveBeenCalled();
  });

  test("derives media identity from the authenticated live room", async () => {
    const { issueTransientToken, resolveAccess, service } = makeService({
      room: { ...ROOM, sourceUri: ROOM.sourceUri.replace("/42", "/43") },
    });

    expect(await service(await makeCapability())).toMatchObject({ ok: true });
    expect(resolveAccess).toHaveBeenCalledWith(expect.anything(), {
      serverId: "server-1",
      ratingKey: "43",
    });
    expect(issueTransientToken).toHaveBeenCalledTimes(1);
  });

  test("rejects an expired invite before loading or minting", async () => {
    const { issueTransientToken, service } = makeService();

    expect(await service(await makeCapability({ expired: true }))).toEqual({
      ok: false,
      reason: "expired-invite",
    });
    expect(issueTransientToken).not.toHaveBeenCalled();
  });
});
