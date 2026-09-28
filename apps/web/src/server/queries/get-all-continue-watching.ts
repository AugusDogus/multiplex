import {
  getServerUrl,
  type PlexTvClient,
  type ContinueWatchingResponse,
  type PinnedSource,
  type PlexDevice,
} from "@multiplex/plex-query";
import { getServersQuery } from "~/server/queries/get-servers";
import { getUserInfoQuery } from "~/server/queries/get-user-info";
import { withPmsRetry } from "~/server/queries/plex-server-context";

type ContinueWatchingItemWithServer = ContinueWatchingResponse["items"][0] & {
  serverUrl: string | undefined;
  authToken: string | undefined;
  serverName: string;
};

// The client collection owns caching and polling. Each server read must see
// current Plex state rather than join a cached fill started before a removal.
export async function getAllContinueWatchingQuery(
  plex: PlexTvClient,
): Promise<ContinueWatchingItemWithServer[]> {
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

  const sourcesByServer = new Map<string, PinnedSource[]>();
  for (const source of pinnedSources) {
    const serverSources = sourcesByServer.get(source.machineIdentifier);
    if (serverSources) {
      serverSources.push(source);
    } else {
      sourcesByServer.set(source.machineIdentifier, [source]);
    }
  }

  const serverPromises = Array.from(sourcesByServer).map(
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

  return [...allItems].sort(
    (a: ContinueWatchingItemWithServer, b: ContinueWatchingItemWithServer) => {
      const aTime = a.lastViewedAt?.getTime() ?? 0;
      const bTime = b.lastViewedAt?.getTime() ?? 0;
      return bTime - aTime;
    },
  );
}
