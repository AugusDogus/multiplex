import {
  getServerUrl,
  type ContinueWatchingResponse,
  type PinnedSource,
  type PlexDevice,
  type PlexTvClient,
} from "@multiplex/plex-query";
import { getServersQuery } from "~/server/queries/get-servers";
import { getUserInfoQuery } from "~/server/queries/get-user-info";
import { withPmsRetry } from "~/server/queries/plex-server-context";

export async function getAllContinueWatchingQuery(plex: PlexTvClient) {
  const [servers, userInfo] = await Promise.all([
    getServersQuery(plex),
    getUserInfoQuery(plex),
  ]);

  if (!servers || !userInfo) {
    return [];
  }

  const pinnedSources = userInfo.settings?.sidebarSettings?.pinnedSources ?? [];

  if (pinnedSources.length === 0) {
    return [];
  }

  const sourcesByServer = pinnedSources.reduce(
    (acc, source) => {
      acc[source.machineIdentifier] ??= [];
      acc[source.machineIdentifier]!.push(source);
      return acc;
    },
    {} as Record<string, PinnedSource[]>,
  );

  const serverPromises = Object.entries(sourcesByServer).map(
    async ([machineIdentifier, sources]) => {
      const server = servers.find(
        (s) => s.clientIdentifier === machineIdentifier,
      );

      if (!server) {
        return null;
      }

      const directoryIds = sources.map((source) => source.directoryID);

      const response = await withPmsRetry(plex, server, userInfo, (context) =>
        context.serverClient.getContinueWatching(directoryIds),
      );

      return { response, server };
    },
  );

  const serverResults = (await Promise.allSettled(serverPromises)).flatMap(
    (result) => (result.status === "fulfilled" ? [result.value] : []),
  );

  const successfulResults = serverResults.filter(
    (
      result,
    ): result is {
      response: ContinueWatchingResponse;
      server: PlexDevice;
    } => result !== null,
  );

  const allItems = successfulResults.flatMap(({ response, server }) => {
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

  type ItemWithServer = (typeof allItems)[number];

  return [...allItems].sort((a: ItemWithServer, b: ItemWithServer) => {
    const aTime = a.lastViewedAt?.getTime() ?? 0;
    const bTime = b.lastViewedAt?.getTime() ?? 0;
    return bTime - aTime;
  });
}
