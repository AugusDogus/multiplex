import {
  getServerUrl,
  getThumbnailUrl,
  type ContinueWatchingResponse,
  type PinnedSource,
  type PlexDevice,
  type PlexTvClient,
} from "@multiplex/plex-query";
import { analyzeImageProgressColor } from "~/server/utils/image-analysis";

export async function getAllContinueWatchingQuery(plex: PlexTvClient) {
  try {
    // Get servers and user info
    const [servers, userInfo] = await Promise.all([
      plex.getServers(),
      plex.getUserInfo(),
    ]);

    if (!servers || !userInfo) {
      return [];
    }

    // Extract pinned sources from user settings
    const pinnedSources =
      userInfo.settings?.sidebarSettings?.pinnedSources ?? [];

    if (pinnedSources.length === 0) {
      return [];
    }

    // Group pinned sources by server (machineIdentifier)
    const sourcesByServer = pinnedSources.reduce(
      (acc, source) => {
        acc[source.machineIdentifier] ??= [];
        acc[source.machineIdentifier]!.push(source);
        return acc;
      },
      {} as Record<string, PinnedSource[]>,
    );

    // Fetch Continue Watching from each server that has pinned sources
    const serverPromises = Object.entries(sourcesByServer).map(
      async ([machineIdentifier, sources]) => {
        try {
          // Find the server
          const server = servers.find(
            (s) => s.clientIdentifier === machineIdentifier,
          );

          if (!server) {
            return null;
          }

          // Extract directory IDs from pinned sources
          const directoryIds = sources.map((source) => source.directoryID);

          // Create server client and get Continue Watching data
          const serverClient = plex.createServerClient(server);
          const response = await serverClient.getContinueWatching(directoryIds);

          return { response, server };
        } catch {
          return null;
        }
      },
    );

    const serverResults = (await Promise.all(serverPromises)).filter(
      (
        result,
      ): result is {
        response: ContinueWatchingResponse;
        server: PlexDevice;
      } => result !== null,
    );

    // Combine all items from all servers with server connection info
    const allItems = serverResults.flatMap(({ response, server }) => {
      const serverUrl = getServerUrl(server);
      const authToken = server.accessToken ?? userInfo.authToken;

      const items = Array.isArray(response.items) ? response.items : [];
      return items.map((item: ContinueWatchingResponse["items"][0]) => ({
        ...item,
        serverUrl,
        authToken,
        serverName: server.name,
      }));
    });

    // Process images for progress color analysis
    const itemsWithProgressColor = await Promise.all(
      allItems.map(async (item) => {
        try {
          const thumbnailUrl = getThumbnailUrl(
            item,
            item.serverUrl,
            item.authToken,
          );
          if (thumbnailUrl) {
            const progressColor = await analyzeImageProgressColor(thumbnailUrl);
            return { ...item, progressColor };
          }
        } catch (error) {
          console.warn(
            `Failed to analyze progress color for item ${item.ratingKey}:`,
            error,
          );
        }
        return { ...item, progressColor: "light" as const };
      }),
    );

    // Sort by most recently watched using functional approach
    type ItemWithServer = (typeof itemsWithProgressColor)[number];

    const sortedItems = [...itemsWithProgressColor].sort(
      (a: ItemWithServer, b: ItemWithServer) => {
        const aTime = a.lastViewedAt?.getTime() ?? 0;
        const bTime = b.lastViewedAt?.getTime() ?? 0;
        return bTime - aTime;
      },
    );

    return sortedItems;
  } catch {
    return [];
  }
}
