import { describe, expect, mock, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import type {
  ItemMetadata,
  PlexDevice,
  PlexServerClient,
  PlexTvClient,
} from "@multiplex/plex-query";

import {
  resolveGuestAccess,
  resolveGuestParty,
  toGuestShareEligibility,
} from "./guest-access";

const HOME_USERS = [
  {
    id: 1,
    uuid: "owner-uuid",
    title: "Owner",
    admin: true,
    guest: false,
    protected: false,
    restricted: false,
  },
  {
    id: 2,
    uuid: "guest-uuid",
    title: "Guest",
    admin: false,
    guest: true,
    protected: false,
    restricted: true,
  },
];

const SERVER: PlexDevice = {
  name: "Server",
  product: "Plex Media Server",
  productVersion: "1",
  platform: "Linux",
  platformVersion: "1",
  device: "PC",
  clientIdentifier: "server-1",
  createdAt: "0",
  lastSeenAt: "0",
  provides: "server",
  ownerId: 1,
  sourceTitle: null,
  publicAddress: "example.plex.direct",
  accessToken: "durable-guest-token",
  owned: false,
  home: true,
  synced: false,
  relay: false,
  presence: true,
  httpsRequired: true,
  publicAddressMatches: false,
  connections: [
    {
      protocol: "https",
      address: "example.plex.direct",
      port: 443,
      uri: "https://example.plex.direct",
      local: false,
      relay: false,
      IPv6: false,
    },
  ],
};

const ITEM = fromPartial<ItemMetadata>({
  ratingKey: "42",
  key: "/library/metadata/42",
  title: "Movie",
  type: "movie",
  Media: [{ Part: [{ key: "/library/parts/42/file.mp4" }] }],
});

test("reports when only the Home admin can enable a missing Guest", async () => {
  const host = fromPartial<PlexTvClient>({
    getHomeUsers: mock(async () => [HOME_USERS[0]]),
    getUserInfo: mock(async () => ({ id: 1 })),
  });

  const result = await resolveGuestAccess(host, {
    serverId: "server-1",
    ratingKey: "42",
  });

  expect(toGuestShareEligibility(result)).toEqual({
    status: "unavailable",
    reason: "guest-disabled",
    canEnableGuest: true,
  });
});

describe("resolveGuestAccess", () => {
  test("proves Guest access to the selected server and item", async () => {
    const getItemMetadata = mock(async () => ITEM);
    const getConnectionUri = mock(async () => "https://proven.plex.direct");
    const serverClient = fromPartial<PlexServerClient>({
      getItemMetadata,
      getConnectionUri,
    });
    const guestPlex = fromPartial<PlexTvClient>({
      getServers: mock(async () => [SERVER]),
      createServerClient: mock(() => serverClient),
    });
    const host = fromPartial<PlexTvClient>({
      getHomeUsers: mock(async () => HOME_USERS),
      getUserInfo: mock(async () => ({ id: 1 })),
      switchHomeUser: mock(async () => ({
        id: 2,
        uuid: "guest-uuid",
        title: "Guest",
        authToken: "switched-guest-token",
        guest: true,
        restricted: true,
      })),
    });

    const result = await resolveGuestAccess(
      host,
      { serverId: "server-1", ratingKey: "42" },
      { createPlexClient: () => guestPlex },
    );

    expect(toGuestShareEligibility(result)).toEqual({
      status: "ready",
      guest: { id: 2, title: "Guest" },
    });
    expect(getItemMetadata).toHaveBeenCalledWith("42");
    expect(getConnectionUri).toHaveBeenCalledTimes(1);
    if (!result.ok) {
      throw new Error("expected Guest access to resolve");
    }
    expect(result.value.playbackServerUrl).toBe("https://proven.plex.direct");
  });

  test("delegates host playback when Plex Guest cannot inherit a shared server", async () => {
    const getItemMetadata = mock(async () => ITEM);
    const serverClient = fromPartial<PlexServerClient>({
      getItemMetadata,
      getConnectionUri: mock(async () => "https://shared.plex.direct"),
    });
    const guestPlex = fromPartial<PlexTvClient>({
      getServers: mock(async () => []),
    });
    const host = fromPartial<PlexTvClient>({
      getHomeUsers: mock(async () => HOME_USERS),
      getUserInfo: mock(async () => ({ id: 1 })),
      switchHomeUser: mock(async () => ({
        id: 2,
        uuid: "guest-uuid",
        title: "Guest",
        authToken: "switched-guest-token",
        guest: true,
        restricted: true,
      })),
      getServers: mock(async () => [SERVER]),
      createServerClient: mock(() => serverClient),
    });

    const result = await resolveGuestAccess(
      host,
      { serverId: "server-1", ratingKey: "42" },
      { createPlexClient: () => guestPlex },
    );

    expect(toGuestShareEligibility(result)).toEqual({
      status: "ready",
      guest: { id: 2, title: "Guest" },
    });
    expect(getItemMetadata).toHaveBeenCalledWith("42");
  });

  test("rejects a server unavailable to both Guest and host", async () => {
    const noServers = mock(async () => []);
    const guestPlex = fromPartial<PlexTvClient>({ getServers: noServers });
    const host = fromPartial<PlexTvClient>({
      getHomeUsers: mock(async () => HOME_USERS),
      getUserInfo: mock(async () => ({ id: 1 })),
      switchHomeUser: mock(async () => ({
        id: 2,
        uuid: "guest-uuid",
        title: "Guest",
        authToken: "switched-guest-token",
        guest: true,
        restricted: true,
      })),
      getServers: noServers,
    });

    const result = await resolveGuestAccess(
      host,
      { serverId: "server-1", ratingKey: "42" },
      { createPlexClient: () => guestPlex },
    );

    expect(toGuestShareEligibility(result)).toEqual({
      status: "unavailable",
      reason: "server-unavailable",
      canEnableGuest: false,
    });
  });
});

describe("resolveGuestParty", () => {
  test("verifies host and Guest membership without resolving playback", async () => {
    const switchHomeUser = mock(() =>
      Promise.reject(new Error("must not resolve playback")),
    );
    const host = fromPartial<PlexTvClient>({
      getHomeUsers: mock(async () => HOME_USERS),
      getUserInfo: mock(async () => ({ id: 1 })),
      switchHomeUser,
    });

    const result = await resolveGuestParty(host);

    expect(result).toMatchObject({
      ok: true,
      hostPlexUserId: 1,
      guest: { id: 2 },
    });
    expect(switchHomeUser).not.toHaveBeenCalled();
  });

  test("preserves a retryable Plex availability failure", async () => {
    const host = fromPartial<PlexTvClient>({
      getHomeUsers: mock(() => Promise.reject(new Error("offline"))),
      getUserInfo: mock(async () => ({ id: 1 })),
    });

    expect(await resolveGuestParty(host)).toEqual({
      ok: false,
      reason: "plex-unavailable",
      canEnableGuest: false,
    });
  });
});
