import { createQuery, createMutation, createDependentQuery } from "./create-query";
import { plexKeys } from "./keys";
import { getPlexConfig } from "./config";
import {
  PlexTvClient,
  PlexServerClient,
  type PlexDevice,
  type PlexUserInfo,
  type ContinueWatchingResponse,
  type MediaContainer,
  type SearchParams,
  type SearchResponse,
  type CreatePlayQueueParams,
  type PlayQueueResponse,
  getServerUrl,
} from "./plex";
import type { ContinueWatchingItem } from "./plex/schemas/continue-watching-schemas";

/* ────────────────────────────────────────────────────────────
   Helper Types
   ──────────────────────────────────────────────────────────── */

type TokenParam = string | null;

interface ServerTokenParams {
  server: PlexDevice;
  token: string;
}

interface ContinueWatchingItemWithServer extends ContinueWatchingItem {
  serverUrl?: string;
  authToken?: string;
  serverId: string;
}

/* ────────────────────────────────────────────────────────────
   Helper Functions
   ──────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────
   Plex.tv API Queries
   ──────────────────────────────────────────────────────────── */

const getServers = createQuery<PlexDevice[], TokenParam>({
  queryKey: () => plexKeys.servers(),
  queryFn: async (token) => {
    if (!token) throw new Error("No auth token provided");
    const client = new PlexTvClient(token, getPlexConfig());
    return client.getServers();
  },
  defaultOptions: {
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: false, // Must be explicitly enabled via options
  },
});

const getUserInfo = createQuery<PlexUserInfo, TokenParam>({
  queryKey: () => plexKeys.userInfo(),
  queryFn: async (token) => {
    if (!token) throw new Error("No auth token provided");
    const client = new PlexTvClient(token, getPlexConfig());
    return client.getUserInfo();
  },
  defaultOptions: {
    staleTime: 10 * 60 * 1000, // 10 minutes
    enabled: false,
  },
});

/* ────────────────────────────────────────────────────────────
   Continue Watching Queries
   ──────────────────────────────────────────────────────────── */

/**
 * Helper function to fetch continue watching items
 * Used by both the standalone and dependent query versions
 */
async function fetchContinueWatchingItems(
  token: string,
  servers: PlexDevice[],
  userInfo: PlexUserInfo
): Promise<ContinueWatchingItemWithServer[]> {
  const config = getPlexConfig();

  // Extract pinned sources from user settings
  const pinnedSources = userInfo.settings?.sidebarSettings?.pinnedSources ?? [];

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
    {} as Record<string, typeof pinnedSources>
  );

  // Fetch Continue Watching from each server that has pinned sources
  const serverPromises = Object.entries(sourcesByServer).map(
    async ([machineIdentifier, sources]) => {
      try {
        const server = servers.find((s) => s.clientIdentifier === machineIdentifier);
        if (!server) return null;

        const directoryIds = sources.map((source) => source.directoryID);
        const serverClient = new PlexServerClient(server, token, config);
        const response = await serverClient.getContinueWatching(directoryIds);

        return { response, server };
      } catch {
        return null;
      }
    }
  );

  const serverResults = (await Promise.all(serverPromises)).filter(
    (result): result is { response: ContinueWatchingResponse; server: PlexDevice } =>
      result !== null
  );

  // Combine all items from all servers with server connection info
  const allItems = serverResults.flatMap(({ response, server }) => {
    const serverUrl = getServerUrl(server);
    const authToken = server.accessToken ?? token;

    const items = Array.isArray(response.items) ? response.items : [];
    return items.map(
      (item): ContinueWatchingItemWithServer => ({
        ...item,
        serverUrl,
        authToken,
        serverId: server.clientIdentifier,
      })
    );
  });

  // Sort by most recently watched
  const sortedItems = [...allItems].sort((a, b) => {
    const aTime = a.lastViewedAt?.getTime() ?? 0;
    const bTime = b.lastViewedAt?.getTime() ?? 0;
    return bTime - aTime;
  });

  return sortedItems;
}

/**
 * Standalone Continue Watching query that fetches servers and userInfo internally.
 * This allows it to run in parallel with other queries, avoiding waterfalls.
 */
const getContinueWatching = createQuery<ContinueWatchingItemWithServer[], TokenParam>({
  queryKey: () => plexKeys.allContinueWatching(),
  queryFn: async (token) => {
    if (!token) throw new Error("No auth token provided");

    const config = getPlexConfig();
    const tvClient = new PlexTvClient(token, config);

    // Fetch servers and userInfo in parallel
    const [servers, userInfo] = await Promise.all([
      tvClient.getServers(),
      tvClient.getUserInfo(),
    ]);

    return fetchContinueWatchingItems(token, servers, userInfo);
  },
  defaultOptions: {
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    enabled: false,
  },
});

interface AllContinueWatchingParams {
  token: string;
  servers: PlexDevice[];
  userInfo: PlexUserInfo;
}

/**
 * Dependent Continue Watching query - use when servers and userInfo are already available.
 * Avoids refetching servers/userInfo if they're already in cache.
 */
const getAllContinueWatching = createDependentQuery<
  ContinueWatchingItemWithServer[],
  AllContinueWatchingParams
>({
  queryKey: () => plexKeys.allContinueWatching(),
  queryFn: async ({ token, servers, userInfo }) => {
    return fetchContinueWatchingItems(token, servers, userInfo);
  },
  enabled: (params) => !!params.token && params.servers.length > 0,
  defaultOptions: {
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  },
});

/* ────────────────────────────────────────────────────────────
   Server-Specific Queries
   ──────────────────────────────────────────────────────────── */

const getMediaProviders = createQuery<MediaContainer, ServerTokenParams>({
  queryKey: ({ server }) => plexKeys.mediaProviders(server.clientIdentifier),
  queryFn: async ({ server, token }) => {
    const client = new PlexServerClient(server, token, getPlexConfig());
    return client.getMediaProviders();
  },
  defaultOptions: {
    staleTime: 5 * 60 * 1000,
  },
});

interface SearchQueryParams extends ServerTokenParams {
  params: SearchParams;
}

const search = createQuery<SearchResponse, SearchQueryParams>({
  queryKey: ({ server, params }) => plexKeys.search(server.clientIdentifier, params.query),
  queryFn: async ({ server, token, params }) => {
    const client = new PlexServerClient(server, token, getPlexConfig());
    return client.search(params);
  },
  defaultOptions: {
    staleTime: 30 * 1000,
  },
});

/* ────────────────────────────────────────────────────────────
   Mutations
   ──────────────────────────────────────────────────────────── */

interface CreatePlayQueueMutationParams extends ServerTokenParams {
  params: CreatePlayQueueParams;
}

const createPlayQueue = createMutation<PlayQueueResponse, CreatePlayQueueMutationParams>({
  mutationFn: async ({ server, token, params }) => {
    const client = new PlexServerClient(server, token, getPlexConfig());
    return client.createPlayQueue(params);
  },
});

interface SendTimelineParams extends ServerTokenParams {
  ratingKey: string;
  key: string;
  playQueueItemID?: string;
  playbackTime: number;
  time: number;
  duration: number;
  state: "playing" | "paused" | "buffering" | "stopped";
  hasMDE?: number;
  context?: string;
  sessionId: string;
}

const sendTimeline = createMutation<void, SendTimelineParams>({
  mutationFn: async ({ server, token, ...params }) => {
    const client = new PlexServerClient(server, token, getPlexConfig());
    return client.sendTimeline(params);
  },
});

/* ────────────────────────────────────────────────────────────
   Exported API Object
   ──────────────────────────────────────────────────────────── */

/**
 * Plex API with tRPC-like interface
 *
 * @example
 * ```tsx
 * import { api } from "@multiplex/plex-query";
 *
 * // Queries
 * const { data: servers } = api.plex.getServers.useQuery(token, { enabled: !!token });
 * const { data: userInfo } = api.plex.getUserInfo.useQuery(token, { enabled: !!token });
 *
 * // Mutations
 * const createQueue = api.plex.createPlayQueue.useMutation();
 * await createQueue.mutateAsync({ server, token, params });
 * ```
 */
export const api = {
  plex: {
    // Plex.tv queries
    getServers,
    getUserInfo,

    // Continue Watching
    /** Standalone query - fetches servers/userInfo internally. Use for parallel loading. */
    getContinueWatching,
    /** Dependent query - use when servers/userInfo are already available. */
    getAllContinueWatching,

    // Server-specific queries
    getMediaProviders,
    search,

    // Mutations
    createPlayQueue,
    sendTimeline,
  },
};

// Re-export types for consumers
export type { ContinueWatchingItemWithServer, AllContinueWatchingParams };
