import type { PlexTvClient } from "@multiplex/plex-query";

export async function getContinueWatchingQuery(
  plex: PlexTvClient,
  serverId: string,
  contentDirectoryIds: string[],
) {
  // Get servers and find the one we want
  const servers = await plex.getServers();
  const server = servers.find((s) => s.clientIdentifier === serverId);

  if (!server) {
    throw new Error(`Server not found: ${serverId}`);
  }

  try {
    // Create server client and get Continue Watching data
    const serverClient = plex.createServerClient(server);
    const continueWatchingData =
      await serverClient.getContinueWatching(contentDirectoryIds);

    return continueWatchingData;
  } catch {
    // Return empty response instead of throwing to allow other servers to succeed
    return {
      serverId: server.clientIdentifier,
      totalSize: 0,
      allowSync: false,
      hubs: [],
      items: [],
    };
  }
}
