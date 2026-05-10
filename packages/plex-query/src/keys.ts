/**
 * Query key factory for Plex API queries
 * Provides type-safe, hierarchical query keys for React Query
 */
export const plexKeys = {
  all: ["plex"] as const,

  // Server-related keys
  servers: () => [...plexKeys.all, "servers"] as const,
  server: (serverId: string) => [...plexKeys.servers(), serverId] as const,

  // User-related keys
  userInfo: () => [...plexKeys.all, "userInfo"] as const,

  // Continue Watching
  continueWatching: (serverId: string) =>
    [...plexKeys.server(serverId), "continueWatching"] as const,
  allContinueWatching: () => [...plexKeys.all, "allContinueWatching"] as const,

  // Media providers and libraries
  mediaProviders: (serverId: string) => [...plexKeys.server(serverId), "mediaProviders"] as const,
  librarySections: (serverId: string) => [...plexKeys.server(serverId), "librarySections"] as const,
  libraryContent: (serverId: string, sectionId: string) =>
    [...plexKeys.server(serverId), "library", sectionId] as const,

  // Search
  search: (serverId: string, query: string) =>
    [...plexKeys.server(serverId), "search", query] as const,

  // Play queues
  playQueue: (serverId: string, playQueueId: string) =>
    [...plexKeys.server(serverId), "playQueue", playQueueId] as const,
};

// Helper type to extract return types from query key functions
type QueryKeyFunctions = Exclude<(typeof plexKeys)[keyof typeof plexKeys], readonly string[]>;

export type PlexQueryKey = (typeof plexKeys)["all"] | ReturnType<QueryKeyFunctions>;
