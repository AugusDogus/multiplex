import {
  filterBrowsableHubs,
  type HubWithServer,
  type PlexDevice,
  type PlexTvClient,
  type PlexUserInfo,
} from "@multiplex/plex-query";
import { getServersQuery } from "~/server/queries/get-servers";
import { getUserInfoQuery } from "~/server/queries/get-user-info";
import {
  buildPlexServerContext,
  enrichHubsWithServer,
} from "~/server/queries/plex-server-context";
import { retryAsync } from "~/server/utils/retry";

const PMS_REQUEST_RETRY_OPTIONS = {
  attempts: 5,
  baseDelayMs: 1_000,
} as const;

async function fetchHomeHubsForServer(
  plex: PlexTvClient,
  server: PlexDevice,
  userInfo: PlexUserInfo,
  libraryDirectoryIds: string[],
): Promise<HubWithServer[]> {
  return retryAsync(async () => {
    const context = buildPlexServerContext(plex, server, userInfo);
    const response = await context.serverClient.getHubs({
      onlyTransient: true,
      contentDirectoryIds: libraryDirectoryIds,
    });

    const hubs = enrichHubsWithServer(
      filterBrowsableHubs(response.hubs),
      context,
    );

    // PMS can return empty hub rows on a cold first connection even when the
    // account has pinned libraries with content. Treat that as transient.
    if (hubs.length === 0 && libraryDirectoryIds.length > 0) {
      throw new Error("Home hubs empty despite pinned libraries");
    }

    return hubs;
  }, PMS_REQUEST_RETRY_OPTIONS);
}

export async function getHomeHubsQuery(
  plex: PlexTvClient,
): Promise<HubWithServer[]> {
  const [servers, userInfo] = await Promise.all([
    getServersQuery(plex),
    getUserInfoQuery(plex),
  ]);

  if (!servers.length || !userInfo) {
    return [];
  }

  const preferredServerId = userInfo.settings?.homeSettings?.preferredServerID;
  const server =
    servers.find((entry) => entry.clientIdentifier === preferredServerId) ??
    servers[0];

  if (!server) {
    return [];
  }

  const pinnedSources = userInfo.settings?.sidebarSettings?.pinnedSources ?? [];
  const libraryDirectoryIds = pinnedSources
    .map((source) => source.directoryID)
    .filter((id) => /^\d+$/.test(id));

  return fetchHomeHubsForServer(plex, server, userInfo, libraryDirectoryIds);
}
