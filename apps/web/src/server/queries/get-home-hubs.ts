import {
  filterBrowsableHubs,
  type HubWithServer,
  type PlexTvClient,
} from "@multiplex/plex-query";
import {
  enrichHubsWithServer,
  resolvePlexServerContext,
} from "~/server/queries/plex-server-context";

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
      servers.find((entry) => entry.clientIdentifier === preferredServerId) ??
      servers[0];

    if (!server) {
      return [];
    }

    const context = await resolvePlexServerContext(
      plex,
      server.clientIdentifier,
    );

    if (!context) {
      return [];
    }

    const pinnedSources =
      userInfo.settings?.sidebarSettings?.pinnedSources ?? [];
    const libraryDirectoryIds = pinnedSources
      .map((source) => source.directoryID)
      .filter((id) => /^\d+$/.test(id));

    const response = await context.serverClient.getHubs({
      onlyTransient: true,
      contentDirectoryIds: libraryDirectoryIds,
    });

    return enrichHubsWithServer(filterBrowsableHubs(response.hubs), context);
  } catch {
    return [];
  }
}
