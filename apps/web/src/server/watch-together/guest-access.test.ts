import { describe, expect, mock, test } from "bun:test";
import type {
  ItemMetadata,
  PlexDevice,
  PlexServerClient,
  PlexTvClient,
} from "@multiplex/plex-query";

import { resolveGuestAccess, toGuestShareEligibility } from "./guest-access";

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

const ITEM = {
  ratingKey: "42",
  key: "/library/metadata/42",
  title: "Movie",
  type: "movie",
  Media: [{ Part: [{ key: "/library/parts/42/file.mp4" }] }],
} as ItemMetadata;

test("reports when only the Home admin can enable a missing Guest", async () => {
  const host = {
    getHomeUsers: mock(async () => [HOME_USERS[0]]),
    getUserInfo: mock(async () => ({ id: 1 })),
  } as unknown as PlexTvClient;

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
    const serverClient = {
      getItemMetadata,
    } as unknown as PlexServerClient;
    const guestPlex = {
      getServers: mock(async () => [SERVER]),
      createServerClient: mock(() => serverClient),
    } as unknown as PlexTvClient;
    const host = {
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
    } as unknown as PlexTvClient;

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

  test("does not treat host access as Guest server access", async () => {
    const guestPlex = {
      getServers: mock(async () => []),
    } as unknown as PlexTvClient;
    const host = {
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
    } as unknown as PlexTvClient;

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
