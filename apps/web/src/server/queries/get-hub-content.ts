import {
  getServerUrl,
  type HubItemWithServer,
  type PlexTvClient,
} from "@multiplex/plex-query";

export async function getHubContentQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  hubKey: string,
  options?: { start?: number; size?: number },
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
    };
  }

  const serverClient = plex.createServerClient(server);
  const response = await serverClient.getHubContent(hubKey, {
    start: options?.start ?? 0,
    size: options?.size ?? 48,
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
  };
}
