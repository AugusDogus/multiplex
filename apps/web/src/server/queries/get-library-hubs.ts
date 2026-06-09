import {
  filterBrowsableHubs,
  getServerUrl,
  type HubWithServer,
  type PlexTvClient,
} from "@multiplex/plex-query";

export async function getLibraryHubsQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
): Promise<HubWithServer[]> {
  try {
    const [servers, userInfo] = await Promise.all([
      plex.getServers(),
      plex.getUserInfo(),
    ]);

    const server = servers.find(
      (s) => s.clientIdentifier === machineIdentifier,
    );

    if (!server || !userInfo) {
      return [];
    }

    const serverClient = plex.createServerClient(server);
    const response = await serverClient.getSectionHubs(sectionId, {
      onlyTransient: true,
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
