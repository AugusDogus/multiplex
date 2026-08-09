import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { PlexDevice } from "../schemas/plex-tv-schemas";
import type { PlexConfig } from "../types/client-types";
import { clearPlexServerConnectionCache } from "./plex-server-client";
import { PlexTvClient } from "./plex-tv-client";

const CONFIG: PlexConfig = {
  product: "Multiplex Test",
  clientIdentifier: "client-id",
  version: "1.0.0",
  platform: "Web",
};

function createFetchMock(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  return Object.assign(mock(implementation), {
    preconnect: mock((_url: string | URL) => undefined),
  });
}

afterEach(() => {
  clearPlexServerConnectionCache();
  mock.restore();
});

function makeServer(
  clientIdentifier: string,
  options: {
    accessToken?: string | null;
    connectionUri?: string;
    relay?: boolean;
  } = {},
): PlexDevice {
  const connectionUri = options.connectionUri ?? `https://${clientIdentifier}.example.test:32400`;
  const parsedUrl = new URL(connectionUri);

  return {
    name: clientIdentifier,
    product: "Plex Media Server",
    productVersion: "1.0.0",
    platform: "Linux",
    platformVersion: "1.0",
    device: "PC",
    clientIdentifier,
    createdAt: "",
    lastSeenAt: "",
    provides: "server",
    ownerId: null,
    sourceTitle: null,
    publicAddress: parsedUrl.hostname,
    accessToken: options.accessToken ?? null,
    owned: true,
    home: false,
    synced: false,
    relay: options.relay ?? false,
    presence: true,
    httpsRequired: parsedUrl.protocol === "https:",
    publicAddressMatches: false,
    connections: [
      {
        protocol: parsedUrl.protocol.slice(0, -1),
        address: parsedUrl.hostname,
        port: Number.parseInt(parsedUrl.port || "32400", 10),
        uri: connectionUri,
        local: false,
        relay: options.relay ?? false,
        IPv6: false,
      },
    ],
  };
}

describe("PlexTvClient server client reuse", () => {
  test("reuses a client for unchanged metadata and isolates servers", () => {
    const plex = new PlexTvClient("account-token", CONFIG);
    const serverA = makeServer("server-a");
    const serverB = makeServer("server-b");

    expect(plex.createServerClient(serverA)).toBe(plex.createServerClient(serverA));
    expect(plex.createServerClient(serverA)).not.toBe(plex.createServerClient(serverB));
  });

  test("replaces a client when its access token changes", () => {
    const plex = new PlexTvClient("account-token", CONFIG);
    const original = plex.createServerClient(makeServer("server-a", { accessToken: "token-a" }));
    const replacement = plex.createServerClient(makeServer("server-a", { accessToken: "token-b" }));

    expect(replacement).not.toBe(original);
  });

  test("replaces a client when ordered connection routing metadata changes", () => {
    const plex = new PlexTvClient("account-token", CONFIG);
    const original = plex.createServerClient(
      makeServer("server-a", { connectionUri: "https://one.example.test:32400" }),
    );
    const replacement = plex.createServerClient(
      makeServer("server-a", { connectionUri: "https://two.example.test:32400" }),
    );

    expect(replacement).not.toBe(original);
  });

  test("avoids repeat probes until the client is invalidated", async () => {
    const plex = new PlexTvClient("account-token", CONFIG);
    const server = makeServer("server-a");
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
            friendlyName: "Test Server",
            machineIdentifier: "server-a",
            MediaProvider: [],
          },
        });
      },
      { preconnect: () => undefined },
    );
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchImplementation);

    try {
      await plex.createServerClient(server).getMediaProviders();
      await plex.createServerClient(server).getMediaProviders();
      expect(identityRequests).toBe(1);

      plex.invalidateServerClient(server.clientIdentifier);
      await plex.createServerClient(server).getMediaProviders();
      expect(identityRequests).toBe(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("PlexTvClient Plex Home", () => {
  test("lists and selects the enabled built-in Guest", async () => {
    spyOn(globalThis, "fetch").mockImplementation(
      createFetchMock(
        async () =>
          new Response(
            `<MediaContainer size="2">
          <User id="10" uuid="owner-uuid" title="Owner" admin="1" guest="0" protected="0" restricted="0" />
          <User id="20" uuid="guest-uuid" title="Guest" admin="0" guest="1" protected="0" restricted="1" />
        </MediaContainer>`,
            { status: 200, headers: { "content-type": "application/xml" } },
          ),
      ),
    );

    const guest = await new PlexTvClient("host-token", CONFIG).getGuestHomeUser();

    expect(guest).toMatchObject({
      id: 20,
      uuid: "guest-uuid",
      guest: true,
      restricted: true,
    });
  });
});

describe("PlexTvClient Plex Community friends", () => {
  test("posts GetAllFriends and maps the Community response", async () => {
    spyOn(globalThis, "fetch").mockImplementation(
      createFetchMock(async (input, init) => {
        const url = new URL(String(input));
        expect(url.toString()).toBe("https://community.plex.tv/api");
        expect(url.searchParams.has("X-Plex-Token")).toBe(false);
        expect(init?.method).toBe("POST");
        expect(Object.fromEntries(new Headers(init?.headers).entries())).toEqual({
          accept: "*/*",
          "content-type": "application/json",
          "x-plex-client-identifier": CONFIG.clientIdentifier,
          "x-plex-platform": CONFIG.platform,
          "x-plex-product": "Plex Web",
          "x-plex-token": "host-token",
          "x-plex-version": CONFIG.version,
        });

        const body = String(init?.body);
        expect(body).toContain('"operationName":"GetAllFriends"');
        for (const field of [
          "allFriendsV2",
          "user",
          "avatar",
          "displayName",
          "id",
          "username",
          "idRaw",
          "createdAt",
        ]) {
          expect(body).toMatch(new RegExp(`\\b${field}\\b`));
        }

        return Response.json({
          data: {
            allFriendsV2: [
              {
                user: {
                  avatar: "",
                  displayName: "Alpha Friend",
                  id: "alpha-friend-uuid",
                  username: "alpha-friend",
                  idRaw: 30,
                },
                createdAt: "2022-08-04T18:47:01.186Z",
              },
              {
                user: {
                  avatar: null,
                  displayName: "",
                  id: "bravo-friend-uuid",
                  username: "Bravo Friend",
                  idRaw: 40,
                },
                createdAt: "2022-08-04T18:47:01.186Z",
              },
            ],
          },
        });
      }),
    );

    const friends = await new PlexTvClient("host-token", CONFIG).getFriends();

    expect(friends).toEqual([
      {
        id: 30,
        uuid: "alpha-friend-uuid",
        title: "Alpha Friend",
        username: "alpha-friend",
        friendlyName: "Alpha Friend",
        thumb: null,
      },
      {
        id: 40,
        uuid: "bravo-friend-uuid",
        title: "Bravo Friend",
        username: "Bravo Friend",
        friendlyName: "Bravo Friend",
        thumb: null,
      },
    ]);
  });

  test("surfaces GraphQL errors", async () => {
    spyOn(globalThis, "fetch").mockImplementation(
      createFetchMock(async () =>
        Response.json({ errors: [{ message: "Community friends are unavailable" }] }),
      ),
    );

    const request = new PlexTvClient("host-token", CONFIG).getFriends();

    await expect(request).rejects.toThrow(
      "Plex friends request failed: Community friends are unavailable",
    );
  });
});

describe("PlexTvClient Watch Together invitees", () => {
  test("merges source authority without losing known restrictions", async () => {
    spyOn(globalThis, "fetch").mockImplementation(
      createFetchMock(
        async () =>
          new Response(
            `<MediaContainer size="3">
            <User id="20" uuid="built-in-guest-uuid" title="Guest" username="guest-home" restricted="1" />
            <User id="30" uuid="shared-duplicate-uuid" title="Shared Duplicate" username="shared-duplicate" restricted="1" />
            <User id="50" uuid="charlie-shared-uuid" title="Charlie Shared" username="charlie-shared" restricted="0" />
          </MediaContainer>`,
            { status: 200, headers: { "content-type": "application/xml" } },
          ),
      ),
    );

    const plex = new PlexTvClient("host-token", CONFIG);
    spyOn(plex, "getFriends").mockResolvedValue([
      {
        id: 30,
        uuid: "community-duplicate-uuid",
        title: "Alpha Friend",
        username: "alpha-friend",
        friendlyName: "Alpha Friend",
        thumb: "https://plex.tv/alpha-avatar",
      },
      {
        id: 40,
        uuid: "bravo-friend-uuid",
        title: "Bravo Friend",
        username: "bravo-friend",
        friendlyName: "Bravo Friend",
        thumb: null,
      },
      {
        id: 20,
        uuid: "built-in-guest-uuid",
        title: "Guest",
        username: "guest-home",
        friendlyName: "Guest",
        thumb: null,
      },
    ]);
    spyOn(plex, "getGuestHomeUser").mockResolvedValue({
      id: 20,
      uuid: "built-in-guest-uuid",
      title: "Guest",
      username: null,
      thumb: null,
      admin: false,
      guest: true,
      protected: false,
      restricted: true,
    });

    const invitees = await plex.getWatchTogetherInvitees();

    expect(invitees.map((invitee) => invitee.id)).toEqual([30, 40, 50]);
    expect(invitees[0]).toEqual({
      id: 30,
      uuid: "community-duplicate-uuid",
      title: "Alpha Friend",
      username: "alpha-friend",
      friendlyName: "Alpha Friend",
      thumb: "https://plex.tv/alpha-avatar",
      restricted: true,
    });
  });
});

describe("PlexTvClient Plex Home mutations", () => {
  test("switches with the Guest UUID on the v2 JSON endpoint", async () => {
    const request = createFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v2/home/users/guest-uuid/switch");
      expect(url.searchParams.get("X-Plex-Token")).toBe("host-token");
      expect(init?.method).toBe("POST");
      return Response.json(
        {
          id: 20,
          uuid: "guest-uuid",
          title: "Guest",
          authToken: "switched-guest-token",
          guest: true,
          restricted: true,
        },
        { status: 201 },
      );
    });
    spyOn(globalThis, "fetch").mockImplementation(request);

    const switched = await new PlexTvClient("host-token", CONFIG).switchHomeUser("guest-uuid");

    expect(switched.authToken).toBe("switched-guest-token");
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("uses POST when enabling Guest creates a Plex Home", async () => {
    const request = createFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/home");
      expect(url.searchParams.get("guestEnabled")).toBe("1");
      expect(init?.method).toBe("POST");
      return new Response(null, { status: 201 });
    });
    spyOn(globalThis, "fetch").mockImplementation(request);

    await new PlexTvClient("host-token", CONFIG).enableGuestHomeUser(1);

    expect(request).toHaveBeenCalledTimes(1);
  });

  test("uses PUT when enabling Guest in an existing Plex Home", async () => {
    const request = createFetchMock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      return new Response(null, { status: 200 });
    });
    spyOn(globalThis, "fetch").mockImplementation(request);

    await new PlexTvClient("host-token", CONFIG).enableGuestHomeUser(3);

    expect(request).toHaveBeenCalledTimes(1);
  });
});
