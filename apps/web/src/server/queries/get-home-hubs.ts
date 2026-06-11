import {
  filterBrowsableHubs,
  type HubWithServer,
  type PlexTvClient,
} from "@multiplex/plex-query";
import { getServersQuery } from "~/server/queries/get-servers";
import { getUserInfoQuery } from "~/server/queries/get-user-info";
import {
  buildPlexServerContext,
  enrichHubsWithServer,
} from "~/server/queries/plex-server-context";

export async function getHomeHubsQuery(
  plex: PlexTvClient,
): Promise<HubWithServer[]> {
  try {
    const [servers, userInfo] = await Promise.all([
      getServersQuery(plex),
      getUserInfoQuery(plex),
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

    const context = buildPlexServerContext(plex, server, userInfo);

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
