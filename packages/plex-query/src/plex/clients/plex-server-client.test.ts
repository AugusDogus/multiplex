import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import type { PlexDevice } from "../schemas/plex-tv-schemas";
import type { PlexConfig } from "../types/client-types";
import { PlexAPIError } from "../types/client-types";
import { clearPlexServerConnectionCache, PlexServerClient } from "./plex-server-client";
import { PlexTvClient } from "./plex-tv-client";

const CONFIG: PlexConfig = {
  product: "Multiplex Test",
  clientIdentifier: "client-id",
  version: "1.0.0",
  platform: "Web",
};

const requests: Array<{ method: string; url: URL }> = [];

afterEach(() => {
  requests.length = 0;
  clearPlexServerConnectionCache();
  mock.restore();
});

function makeClient(responseFor: (url: URL, method: string) => Response) {
  const fetchImplementation = Object.assign(
    async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      const url =
        input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
      const method = init?.method ?? "GET";
      requests.push({ method, url });
      return responseFor(url, method);
    },
    { preconnect: () => undefined },
  );
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchImplementation);
  const client = PlexServerClient.fromConnectionUri(
    "server-1",
    "https://plex.example.test",
    "SERVER_TOKEN_SENTINEL",
    CONFIG,
  );

  return { client, fetchSpy };
}

function playlistFixture(overrides: Record<string, unknown> = {}) {
  return {
    ratingKey: "42",
    key: "/playlists/42/items",
    type: "playlist",
    title: "Road trip",
    smart: false,
    playlistType: "audio",
    leafCount: 2,
    authToken: "MUST_BE_STRIPPED",
    ...overrides,
  };
}

function createFetchMock(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  return Object.assign(mock(implementation), {
    preconnect: mock((_url: string | URL) => undefined),
  });
}

describe("PlexServerClient playlist contracts", () => {
  test("uses the local library provider's playlist access", async () => {
    const { client, fetchSpy } = makeClient(() =>
      Response.json({
        MediaContainer: {
          MediaProvider: [
            {
              identifier: "tv.plex.providers.epg.onconnect:example",
              Feature: [{ type: "playlist", readonly: false }],
            },
            {
              identifier: "com.plexapp.plugins.library",
              Feature: [{ type: "playlist", readonly: true }],
            },
          ],
        },
      }),
    );

    try {
      expect(await client.getPlaylistProviderAccess()).toEqual({
        supported: true,
        readOnly: true,
      });
      expect(requests.map(({ method, url }) => [method, url.pathname])).toEqual([
        ["GET", "/media/providers"],
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("ignores playlist features outside the local library provider", async () => {
    const { client, fetchSpy } = makeClient(() =>
      Response.json({
        MediaContainer: {
          MediaProvider: [
            {
              identifier: "com.plexapp.plugins.library",
              Feature: [{ type: "content" }],
            },
            {
              identifier: "tv.plex.providers.epg.onconnect:example",
              Feature: [{ type: "playlist", readonly: true }],
            },
          ],
        },
      }),
    );

    try {
      expect(await client.getPlaylistProviderAccess()).toEqual({
        supported: false,
        readOnly: false,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("reports playlist access unsupported without a local library provider", async () => {
    const { client, fetchSpy } = makeClient(() =>
      Response.json({
        MediaContainer: {
          MediaProvider: [
            {
              identifier: "tv.plex.providers.epg.onconnect:example",
              Feature: [{ type: "playlist" }],
            },
          ],
        },
      }),
    );

    try {
      expect(await client.getPlaylistProviderAccess()).toEqual({
        supported: false,
        readOnly: false,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("parses allowlisted detail and paged contents with distinct item ids", async () => {
    const { client, fetchSpy } = makeClient((url) => {
      if (url.pathname === "/playlists/42") {
        return Response.json({
          MediaContainer: { size: 1, Metadata: [playlistFixture()] },
        });
      }

      return Response.json({
        MediaContainer: {
          size: 1,
          totalSize: 2,
          offset: 1,
          Metadata: [
            {
              ratingKey: "900",
              key: "/library/metadata/900",
              type: "track",
              title: "Second song",
              playlistItemID: 7002,
              serverUrl: "MUST_BE_STRIPPED",
            },
          ],
        },
      });
    });

    try {
      const detail = await client.getPlaylist("42");
      const contents = await client.getPlaylistContents("42", {
        start: 1,
        size: 1,
      });

      expect(detail).toEqual({
        ratingKey: "42",
        key: "/playlists/42/items",
        type: "playlist",
        title: "Road trip",
        smart: false,
        playlistType: "audio",
        leafCount: 2,
      });
      expect(contents.MediaContainer.Metadata?.[0]).toEqual({
        ratingKey: "900",
        key: "/library/metadata/900",
        type: "track",
        title: "Second song",
        playlistItemID: 7002,
      });
      expect(requests.map(({ method, url }) => [method, url.pathname])).toEqual([
        ["GET", "/playlists/42"],
        ["GET", "/playlists/42/items"],
      ]);
      expect(requests[1]?.url.searchParams.get("X-Plex-Container-Start")).toBe("1");
      expect(requests[1]?.url.searchParams.get("X-Plex-Container-Size")).toBe("1");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("sends exact rename, delete, and reorder contracts", async () => {
    const { client, fetchSpy } = makeClient((_url, method) =>
      method === "PUT" && requests.length === 3
        ? Response.json({
            MediaContainer: {
              size: 1,
              Metadata: [playlistFixture({ title: "Renamed" })],
            },
          })
        : new Response(null, { status: 204 }),
    );

    try {
      await client.renamePlaylist("42", "  Renamed  ");
      await client.deletePlaylist("42");
      await client.movePlaylistItem("42", 7002, 7001);

      const [rename, remove, move] = requests;
      expect([rename?.method, rename?.url.pathname]).toEqual(["PUT", "/playlists/42"]);
      expect(rename?.url.searchParams.get("title")).toBe("Renamed");
      expect([remove?.method, remove?.url.pathname]).toEqual(["DELETE", "/playlists/42"]);
      expect([move?.method, move?.url.pathname]).toEqual(["PUT", "/playlists/42/items/7002/move"]);
      expect(move?.url.searchParams.get("after")).toBe("7001");
      expect(requests.some(({ url }) => url.pathname.endsWith("/items"))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("omits after when moving an item to the beginning", async () => {
    const { client, fetchSpy } = makeClient(() =>
      Response.json({
        MediaContainer: { size: 1, Metadata: [playlistFixture()] },
      }),
    );

    try {
      await client.movePlaylistItem("42", 7002);
      expect(requests[0]?.url.pathname).toBe("/playlists/42/items/7002/move");
      expect(requests[0]?.url.searchParams.has("after")).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("rejects invalid identifiers, paging, titles, and reorder targets", async () => {
    const { client, fetchSpy } = makeClient(() => Response.json({ MediaContainer: { size: 0 } }));

    try {
      await expect(client.getPlaylist("42/items")).rejects.toThrow(TypeError);
      await expect(client.getPlaylistContents("42", { start: -1 })).rejects.toThrow(TypeError);
      await expect(client.renamePlaylist("42", "   ")).rejects.toThrow(TypeError);
      await expect(client.movePlaylistItem("42", 1.5)).rejects.toThrow(TypeError);
      await expect(client.movePlaylistItem("42", 7, 7)).rejects.toThrow(TypeError);
      expect(requests).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("rejects malformed playlist contents", async () => {
    const { client, fetchSpy } = makeClient(() =>
      Response.json({
        MediaContainer: {
          size: 1,
          Metadata: [
            {
              ratingKey: "900",
              key: "/library/metadata/900",
              type: "track",
              title: "Broken",
              playlistItemID: "not-numeric",
            },
          ],
        },
      }),
    );

    try {
      const error = await client.getPlaylistContents("42").catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(PlexAPIError);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("PlexServerClient connection discovery", () => {
  test("races remote success ahead of a hanging local connection", async () => {
    const server: PlexDevice = {
      name: "Haus",
      product: "Plex Media Server",
      productVersion: "1.0.0",
      platform: "Linux",
      platformVersion: "1.0",
      device: "PC",
      clientIdentifier: "haus",
      createdAt: "",
      lastSeenAt: "",
      provides: "server",
      ownerId: null,
      sourceTitle: null,
      publicAddress: "1.2.3.4",
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
          address: "192.168.1.10",
          port: 32400,
          uri: "https://192.168.1.10:32400",
          local: true,
          relay: false,
          IPv6: false,
        },
        {
          protocol: "https",
          address: "remote.plex.direct",
          port: 32400,
          uri: "https://remote.plex.direct:32400",
          local: false,
          relay: false,
          IPv6: false,
        },
      ],
    };

    const fetchImplementation = Object.assign(
      async (input: URL | RequestInfo): Promise<Response> => {
        const url =
          input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
        if (url.hostname === "192.168.1.10") {
          // Hang until the 3s identity abort — must not block remote success.
          return new Promise(() => undefined);
        }
        if (url.pathname.endsWith("/identity")) {
          return new Response(null, { status: 200 });
        }
        return Response.json({
          MediaContainer: {
            size: 0,
            friendlyName: "Haus",
            machineIdentifier: "haus",
            MediaProvider: [],
          },
        });
      },
      { preconnect: () => undefined },
    );
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchImplementation);

    try {
      const started = Date.now();
      await new PlexServerClient(server, "account-token", CONFIG).getMediaProviders();
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("joins an in-flight discovery started by warmConnection on another client", async () => {
    const server: PlexDevice = {
      name: "Haus",
      product: "Plex Media Server",
      productVersion: "1.0.0",
      platform: "Linux",
      platformVersion: "1.0",
      device: "PC",
      clientIdentifier: "haus-inflight",
      createdAt: "",
      lastSeenAt: "",
      provides: "server",
      ownerId: null,
      sourceTitle: null,
      publicAddress: "1.2.3.4",
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
          address: "remote.plex.direct",
          port: 32400,
          uri: "https://remote.plex.direct:32400",
          local: false,
          relay: false,
          IPv6: false,
        },
      ],
    };

    let identityRequests = 0;
    let releaseIdentity: (() => void) | undefined;
    const identityGate = new Promise<void>((resolve) => {
      releaseIdentity = resolve;
    });

    const fetchImplementation = Object.assign(
      async (input: URL | RequestInfo): Promise<Response> => {
        const url =
          input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
        if (url.pathname.endsWith("/identity")) {
          identityRequests += 1;
          await identityGate;
          return new Response(null, { status: 200 });
        }
        return Response.json({
          MediaContainer: {
            size: 0,
            friendlyName: "Haus",
            machineIdentifier: "haus-inflight",
            MediaProvider: [],
          },
        });
      },
      { preconnect: () => undefined },
    );
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchImplementation);

    try {
      const warmer = new PlexTvClient("account-token", CONFIG).createServerClient(server);
      const warmerPromise = warmer.warmConnection();
      await Promise.resolve();
      expect(identityRequests).toBe(1);

      const readerPromise = new PlexTvClient("account-token", CONFIG)
        .createServerClient(server)
        .getMediaProviders();

      releaseIdentity?.();
      await Promise.all([warmerPromise, readerPromise]);
      expect(identityRequests).toBe(1);
    } finally {
      releaseIdentity?.();
      fetchSpy.mockRestore();
    }
  });

  test("reuses a working URI across fresh PlexTvClient instances", async () => {
    const server: PlexDevice = {
      name: "Haus",
      product: "Plex Media Server",
      productVersion: "1.0.0",
      platform: "Linux",
      platformVersion: "1.0",
      device: "PC",
      clientIdentifier: "haus-shared",
      createdAt: "",
      lastSeenAt: "",
      provides: "server",
      ownerId: null,
      sourceTitle: null,
      publicAddress: "1.2.3.4",
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
          address: "remote.plex.direct",
          port: 32400,
          uri: "https://remote.plex.direct:32400",
          local: false,
          relay: false,
          IPv6: false,
        },
      ],
    };

    let identityRequests = 0;
    const fetchImplementation = Object.assign(
      async (input: URL | RequestInfo): Promise<Response> => {
        const url =
          input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
        if (url.pathname.endsWith("/identity")) {
          identityRequests += 1;
          return new Response(null, { status: 200 });
        }
        return Response.json({
          MediaContainer: {
            size: 0,
            friendlyName: "Haus",
            machineIdentifier: "haus-shared",
            MediaProvider: [],
          },
        });
      },
      { preconnect: () => undefined },
    );
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchImplementation);

    try {
      await new PlexTvClient("account-token", CONFIG)
        .createServerClient(server)
        .getMediaProviders();
      await new PlexTvClient("account-token", CONFIG)
        .createServerClient(server)
        .getMediaProviders();
      expect(identityRequests).toBe(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("PlexServerClient.issueTransientToken", () => {
  test("requests a full-scope delegation token and returns only its value", async () => {
    const request = createFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/security/token");
      expect(url.searchParams.get("type")).toBe("delegation");
      expect(url.searchParams.get("scope")).toBe("all");
      expect(url.searchParams.get("X-Plex-Token")).toBe("durable-guest-token");
      expect(init?.method).toBe("POST");
      return Response.json({
        MediaContainer: { token: "transient-guest-token" },
      });
    });
    spyOn(globalThis, "fetch").mockImplementation(request);
    const client = PlexServerClient.fromConnectionUri(
      "server-id",
      "https://example.plex.direct:32400",
      "durable-guest-token",
      CONFIG,
    );

    const token = await client.issueTransientToken();

    expect(token).toBe("transient-guest-token");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
