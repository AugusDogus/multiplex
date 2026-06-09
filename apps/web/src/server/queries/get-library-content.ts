import {
  getServerUrl,
  type HubItemWithServer,
  type PlexTvClient,
} from "@multiplex/plex-query";

export async function getLibraryContentQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  sectionId: string,
  options?: { start?: number; size?: number; sort?: string },
) {
  const [servers, userInfo] = await Promise.all([
    plex.getServers(),
    plex.getUserInfo(),
  ]);

  const server = servers.find((s) => s.clientIdentifier === machineIdentifier);

  if (!server || !userInfo) {
    return {
      items: [] as HubItemWithServer[],
      totalSize: 0,
      offset: 0,
      librarySectionTitle: undefined as string | undefined,
    };
  }

  const serverClient = plex.createServerClient(server);
  const response = await serverClient.getLibraryContent(sectionId, {
    start: options?.start ?? 0,
    size: options?.size ?? 24,
    sort: options?.sort ?? "addedAt:desc",
  });

  const serverUrl = getServerUrl(server);
  const authToken = server.accessToken ?? userInfo.authToken;

  return {
    items: response.items.map((item) => ({
      ...item,
      serverId: server.clientIdentifier,
      serverUrl,
      authToken,
      serverName: server.name,
    })),
    totalSize: response.totalSize,
    offset: response.offset,
    librarySectionTitle: response.librarySectionTitle,
  };
}
