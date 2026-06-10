import {
  getServerUrl,
  type HubItem,
  type HubItemWithServer,
  type PlexDevice,
  type PlexServerClient,
  type PlexTvClient,
  type PlexUserInfo,
} from "@multiplex/plex-query";

export interface PlexServerContext {
  server: PlexDevice;
  userInfo: PlexUserInfo;
  serverClient: PlexServerClient;
  serverUrl: string | undefined;
  authToken: string;
}

export interface PaginatedHubContent {
  items: HubItemWithServer[];
  totalSize: number;
  offset: number;
  librarySectionTitle?: string;
}

export const EMPTY_PAGINATED_HUB_CONTENT: PaginatedHubContent = {
  items: [],
  totalSize: 0,
  offset: 0,
};

export async function resolvePlexServerContext(
  plex: PlexTvClient,
  machineIdentifier: string,
): Promise<PlexServerContext | null> {
  const [servers, userInfo] = await Promise.all([
    plex.getServers(),
    plex.getUserInfo(),
  ]);

  const server = servers.find(
    (entry) => entry.clientIdentifier === machineIdentifier,
  );

  if (!server || !userInfo) {
    return null;
  }

  return {
    server,
    userInfo,
    serverClient: plex.createServerClient(server),
    serverUrl: getServerUrl(server),
    authToken: server.accessToken ?? userInfo.authToken,
  };
}

export function enrichHubItemsWithServer(
  items: HubItem[],
  context: PlexServerContext,
): HubItemWithServer[] {
  return items.map((item) => ({
    ...item,
    serverId: context.server.clientIdentifier,
    serverUrl: context.serverUrl,
    authToken: context.authToken,
    serverName: context.server.name,
  }));
}

export function enrichHubsWithServer<
  THub extends { items: HubItem[] },
  TResult extends THub & { serverId: string; items: HubItemWithServer[] },
>(hubs: THub[], context: PlexServerContext): TResult[] {
  return hubs.map(
    (hub) =>
      ({
        ...hub,
        serverId: context.server.clientIdentifier,
        items: enrichHubItemsWithServer(hub.items, context),
      }) as TResult,
  );
}
