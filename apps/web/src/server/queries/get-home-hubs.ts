import {
  filterBrowsableHubs,
  getServerUrl,
  type HubWithServer,
  type PlexTvClient,
} from "@multiplex/plex-query";

export async function getHomeHubsQuery(
  plex: PlexTvClient,
): Promise<HubWithServer[]> {
  try {
    const [servers, userInfo] = await Promise.all([
      plex.getServers(),
      plex.getUserInfo(),
    ]);

    if (!servers.length || !userInfo) {
      return [];
    }

    const preferredServerId =
      userInfo.settings?.homeSettings?.preferredServerID;
    const server =
      servers.find((s) => s.clientIdentifier === preferredServerId) ??
      servers[0];

    if (!server) {
      return [];
    }

    const pinnedSources =
      userInfo.settings?.sidebarSettings?.pinnedSources ?? [];
    const libraryDirectoryIds = pinnedSources
      .map((source) => source.directoryID)
      .filter((id) => /^\d+$/.test(id));

    const serverClient = plex.createServerClient(server);
    const response = await serverClient.getHubs({
      onlyTransient: true,
      contentDirectoryIds: libraryDirectoryIds,
    });

    const serverUrl = getServerUrl(server);
    const authToken = server.accessToken ?? userInfo.authToken;

    return filterBrowsableHubs(response.hubs).map((hub) => ({
      ...hub,
      serverId: server.clientIdentifier,
      items: hub.items.map((item) => ({
        ...item,
        serverId: server.clientIdentifier,
        serverUrl,
        authToken,
        serverName: server.name,
      })),
    }));
  } catch {
    return [];
  }
}
