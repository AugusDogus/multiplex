import { describe, expect, it } from "bun:test";
import type {
  PlexTvClient,
  WatchTogetherClient,
  WatchTogetherRoom,
} from "@multiplex/plex-query";

import {
  makeStubPlexAuthMiddlewareLive,
  type AuthSession,
  type PlexSessionShape,
} from "./auth-middleware";
import { makePlexWebHandler } from "./handler";

const FIXTURE_ROOMS: WatchTogetherRoom[] = [
  {
    id: "abc123",
    sourceUri:
      "server://machine/com.plexapp.plugins.library/library/metadata/1",
    title: "Fixture Episode",
    type: "episode",
    syncplayHost: "syncplay.plex.tv",
    syncplayPort: 8999,
    users: [{ id: 1, title: "Host", username: "host", thumb: null }],
  },
];

const AUTH_COOKIE = "better-auth.session_token=test-session";

const stubSession = (overrides?: {
  listRooms?: () => Promise<WatchTogetherRoom[]>;
}): PlexSessionShape => {
  const plex = {
    getToken: () => "stub-token",
  } as unknown as PlexTvClient;

  const watchTogether = {
    listRooms: overrides?.listRooms ?? (async () => FIXTURE_ROOMS),
    getRoom: async (roomId: string) => {
      const room = FIXTURE_ROOMS.find((r) => r.id === roomId);
      if (!room) throw new Error("not found");
      return room;
    },
    createRoom: async () => FIXTURE_ROOMS[0]!,
    inviteUsers: async () => undefined,
    deleteRoom: async () => undefined,
  } as unknown as WatchTogetherClient;

  const authSession = {
    user: {
      id: "user-1",
      plexAuthToken: "stub-token",
    },
    session: { id: "sess-1" },
  } as unknown as AuthSession;

  return { authSession, plex, watchTogether };
};

describe("effect-api PlexApi contract", () => {
  it("returns 401 without auth cookie", async () => {
    const { handler, dispose } = makePlexWebHandler();
    try {
      const response = await handler(
        new Request("http://localhost/api/effect/watch-together/rooms"),
      );
      expect(response.status).toBe(401);
    } finally {
      await dispose();
    }
  });

  it("returns 401 on account/servers without auth", async () => {
    const { handler, dispose } = makePlexWebHandler();
    try {
      const response = await handler(
        new Request("http://localhost/api/effect/account/servers"),
      );
      expect(response.status).toBe(401);
    } finally {
      await dispose();
    }
  });

  it("returns fixture rooms with stubbed session", async () => {
    const { handler, dispose } = makePlexWebHandler(
      makeStubPlexAuthMiddlewareLive(stubSession()),
    );
    try {
      const response = await handler(
        new Request("http://localhost/api/effect/watch-together/rooms", {
          headers: { cookie: AUTH_COOKIE },
        }),
      );
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(body).toEqual(FIXTURE_ROOMS);
    } finally {
      await dispose();
    }
  });

  it("rejects invalid roomId with 400", async () => {
    const { handler, dispose } = makePlexWebHandler(
      makeStubPlexAuthMiddlewareLive(stubSession()),
    );
    try {
      const response = await handler(
        new Request(
          "http://localhost/api/effect/watch-together/rooms/bad-id!",
          { headers: { cookie: AUTH_COOKIE } },
        ),
      );
      expect(response.status).toBe(400);
    } finally {
      await dispose();
    }
  });

  it("round-trips StructWithRest extras (permissive boundary)", async () => {
    const roomsWithExtra = [
      {
        ...FIXTURE_ROOMS[0]!,
        mysteryField: "kept",
      },
    ] as WatchTogetherRoom[];
    const { handler, dispose } = makePlexWebHandler(
      makeStubPlexAuthMiddlewareLive(
        stubSession({ listRooms: async () => roomsWithExtra }),
      ),
    );
    try {
      const response = await handler(
        new Request("http://localhost/api/effect/watch-together/rooms", {
          headers: { cookie: AUTH_COOKIE },
        }),
      );
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(Array.isArray(body)).toBe(true);
      const rooms = body as Array<Record<string, unknown>>;
      expect(rooms).toHaveLength(1);
      expect(rooms[0]?.mysteryField).toBe("kept");
      expect(rooms[0]?.id).toBe("abc123");
    } finally {
      await dispose();
    }
  });
});
