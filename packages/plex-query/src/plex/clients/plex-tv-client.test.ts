import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import { PlexTvClient } from "./plex-tv-client";

const CONFIG = {
  product: "Multiplex Test",
  version: "1.0.0",
  clientIdentifier: "multiplex-test-client",
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
  mock.restore();
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

  test("excludes the built-in Home Guest from Watch Together invitees by identity", async () => {
    spyOn(globalThis, "fetch").mockImplementation(
      createFetchMock(async (input) => {
        const url = new URL(String(input));

        if (url.pathname === "/api/v2/friends") {
          return Response.json([
            {
              id: 20,
              uuid: "built-in-guest-uuid",
              title: "Guest",
              username: null,
              friendlyName: null,
              thumb: null,
              restricted: true,
              home: true,
            },
            {
              id: 30,
              uuid: "real-user-named-guest",
              title: "Guest",
              username: "guest-account",
              friendlyName: "Guest",
              thumb: null,
              restricted: false,
            },
          ]);
        }

        if (url.hostname === "clients.plex.tv" && url.pathname === "/api/users") {
          return new Response('<MediaContainer size="0"></MediaContainer>', {
            status: 200,
            headers: { "content-type": "application/xml" },
          });
        }

        if (url.pathname === "/api/home/users") {
          return new Response(
            `<MediaContainer size="2">
              <User id="10" uuid="owner-uuid" title="Owner" admin="1" guest="0" protected="0" restricted="0" />
              <User id="20" uuid="built-in-guest-uuid" title="Guest" admin="0" guest="1" protected="0" restricted="1" />
            </MediaContainer>`,
            { status: 200, headers: { "content-type": "application/xml" } },
          );
        }

        return new Response(null, { status: 404 });
      }),
    );

    const invitees = await new PlexTvClient("host-token", CONFIG).getWatchTogetherInvitees();

    expect(invitees.map((invitee) => invitee.id)).toEqual([30]);
    expect(invitees[0]?.title).toBe("Guest");
  });

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
