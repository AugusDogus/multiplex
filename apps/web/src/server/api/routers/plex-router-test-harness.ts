import { mock, spyOn } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import type { PlexDevice, PlexTvClient } from "@multiplex/plex-query";
import { WatchTogetherClient } from "@multiplex/plex-query";

export const getServersQuery = mock(
  (_plex: PlexTvClient): Promise<PlexDevice[]> => Promise.resolve([]),
);

await mock.module("~/server/queries/get-servers", () => ({ getServersQuery }));

export const createRoom = spyOn(WatchTogetherClient.prototype, "createRoom");

export const SERVER: PlexDevice = {
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

export const AUTH_SESSION = {
  user: { id: "user-1", plexAuthToken: "account-token" },
  session: { id: "session-1" },
};

const { plexRouter } = await import("./plex");

type PlexRouterContext = Parameters<typeof plexRouter.createCaller>[0];

export const makeCaller = (
  plex: PlexTvClient | null,
  authSession: typeof AUTH_SESSION | null = AUTH_SESSION,
) =>
  plexRouter.createCaller(
    fromPartial<PlexRouterContext>({
      authSession,
      plex,
      db: {},
      headers: new Headers(),
    }),
  );
