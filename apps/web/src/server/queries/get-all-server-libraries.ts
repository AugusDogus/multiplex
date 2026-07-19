import { cacheLife } from "next/cache";
import { cache } from "react";
import { PlexTvClient } from "@multiplex/plex-query";
import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";

async function fetchAllServerLibraries(token: string) {
  "use cache";
  cacheLife("minutes");

  const plex = new PlexTvClient(token, NEXTJS_PLEX_CONFIG);
  return loadAllServerLibraries(plex);
}

async function loadAllServerLibraries(plex: PlexTvClient) {
  const servers = await plex.getServers();

  // Fetch library data for all servers in parallel
  const serverLibrariesPromises = servers.map(async (server) => {
    try {
      const serverClient = plex.createServerClient(server);
      const mediaProviders = await serverClient.getMediaProviders();

      return {
        serverId: server.clientIdentifier,
        serverName: server.name,
        serverOwned: server.owned,
        mediaProviders,
        error: undefined,
      };
    } catch (error) {
      return {
        serverId: server.clientIdentifier,
        serverName: server.name,
        serverOwned: server.owned,
        mediaProviders: undefined,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Use Promise.allSettled to handle failures gracefully
  const settledResults = await Promise.allSettled(serverLibrariesPromises);

  // Extract results, handling both fulfilled and rejected promises
  return settledResults.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    } else {
      // Handle rejected promises (network errors, timeouts, etc.)
      const server = servers[index]!;
      return {
        serverId: server.clientIdentifier,
        serverName: server.name,
        serverOwned: server.owned,
        mediaProviders: undefined,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : "Server connection failed",
      };
    }
  });
}

export const getAllServerLibrariesQuery = cache(async (plex: PlexTvClient) => {
  return fetchAllServerLibraries(plex.getToken());
});
