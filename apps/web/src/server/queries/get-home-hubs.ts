import { cacheLife } from "next/cache";
import { cache } from "react";
import {
  filterBrowsableHubs,
  PlexTvClient,
  type HubWithServer,
} from "@multiplex/plex-query";
import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import { getServersQuery } from "~/server/queries/get-servers";
import { getUserInfoQuery } from "~/server/queries/get-user-info";
import {
  enrichHubsWithServer,
  withPmsRetry,
} from "~/server/queries/plex-server-context";

/**
 * Home hubs are relatively stable across short navigations. Cache briefly per
 * token so warm home loads are not gated on another full hubs round-trip.
 */
async function fetchHomeHubs(token: string): Promise<HubWithServer[]> {
  "use cache";
  cacheLife("seconds");

  const plex = new PlexTvClient(token, NEXTJS_PLEX_CONFIG);
  return loadHomeHubs(plex);
}

async function loadHomeHubs(plex: PlexTvClient): Promise<HubWithServer[]> {
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
  const libraryDirectoryIds = pinnedSources.flatMap((source) =>
    /^\d+$/.test(source.directoryID) ? [source.directoryID] : [],
  );

  return withPmsRetry(plex, server, userInfo, async (context) => {
    const response = await context.serverClient.getHubs({
      onlyTransient: true,
      contentDirectoryIds: libraryDirectoryIds,
    });

    return enrichHubsWithServer(filterBrowsableHubs(response.hubs), context);
  });
}

export const getHomeHubsQuery = cache(async (plex: PlexTvClient) => {
  return fetchHomeHubs(plex.getToken());
});
