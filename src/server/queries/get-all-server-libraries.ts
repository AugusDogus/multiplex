import type { PlexTvClient } from "~/lib/plex.tv/clients/plex-tv-client";

export async function getAllServerLibrariesQuery(plex: PlexTvClient) {
  const servers = await plex.getServers();

  // Fetch library data for all servers in parallel
  const serverLibrariesPromises = servers.map(async (server) => {
    try {
      const serverClient = plex.createServerClient(server);
      const mediaProviders = await serverClient.getMediaProviders();

      return {
        serverId: server.clientIdentifier,
        serverName: server.name,
        mediaProviders,
        error: undefined,
      };
    } catch (error) {
      return {
        serverId: server.clientIdentifier,
        serverName: server.name,
        mediaProviders: undefined,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Use Promise.allSettled to handle failures gracefully
  const settledResults = await Promise.allSettled(serverLibrariesPromises);

  // Extract results, handling both fulfilled and rejected promises
  const results = settledResults.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    } else {
      // Handle rejected promises (network errors, timeouts, etc.)
      const server = servers[index]!;
      return {
        serverId: server.clientIdentifier,
        serverName: server.name,
        mediaProviders: undefined,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : "Server connection failed",
      };
    }
  });

  return results;
}
