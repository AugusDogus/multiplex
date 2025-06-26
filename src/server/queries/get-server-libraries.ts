import type { PlexTvClient } from "~/lib/plex.tv/client";

export async function getServerLibrariesQuery(
  plex: PlexTvClient,
  serverId: string,
) {
  // Get servers and find the one we want
  const servers = await plex.getServers();
  const server = servers.find((s) => s.clientIdentifier === serverId);

  if (!server) {
    throw new Error(`Server not found: ${serverId}`);
  }

  try {
    // Create server client and get media providers
    const serverClient = plex.createServerClient(server);
    const mediaProviders = await serverClient.getMediaProviders();

    return {
      serverId: server.clientIdentifier,
      serverName: server.name,
      mediaProviders,
      error: undefined,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    return {
      serverId: server.clientIdentifier,
      serverName: server.name,
      mediaProviders: undefined,
      error: errorMessage,
    };
  }
}
