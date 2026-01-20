import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  PlexTvClient,
  PlexServerClient,
  type PlexDevice,
  type PlexConfig,
  type ContinueWatchingResponse,
  type SearchParams,
  type SearchResponse,
  type CreatePlayQueueParams,
  type PlayQueueResponse,
} from "../lib/plex.tv";

/* ────────────────────────────────────────────────────────────
   Plex React Query Hooks
   Custom hooks for Plex API interactions using React Query
   ──────────────────────────────────────────────────────────── */

// Default Plex client configuration
const DEFAULT_PLEX_CONFIG: PlexConfig = {
  product: "Multiplex",
  clientIdentifier: crypto.randomUUID(),
  version: "1.0.0",
  platform: "Web",
};

// Query keys for cache management
export const plexQueryKeys = {
  all: ["plex"] as const,
  servers: () => [...plexQueryKeys.all, "servers"] as const,
  server: (serverId: string) => [...plexQueryKeys.servers(), serverId] as const,
  userInfo: () => [...plexQueryKeys.all, "userInfo"] as const,
  continueWatching: (serverId: string) =>
    [...plexQueryKeys.server(serverId), "continueWatching"] as const,
  search: (serverId: string, query: string) =>
    [...plexQueryKeys.server(serverId), "search", query] as const,
  mediaProviders: (serverId: string) =>
    [...plexQueryKeys.server(serverId), "mediaProviders"] as const,
  librarySections: (serverId: string) =>
    [...plexQueryKeys.server(serverId), "librarySections"] as const,
  libraryContent: (serverId: string, sectionId: string) =>
    [...plexQueryKeys.server(serverId), "library", sectionId] as const,
  playQueue: (serverId: string, playQueueId: string) =>
    [...plexQueryKeys.server(serverId), "playQueue", playQueueId] as const,
};

/* ────────────────────────────────────────────────────────────
   PlexTvClient Hooks
   ──────────────────────────────────────────────────────────── */

/**
 * Hook to create a PlexTvClient instance
 */
export function usePlexTvClient(
  token: string | null,
  config: PlexConfig = DEFAULT_PLEX_CONFIG,
): PlexTvClient | null {
  return useMemo(() => {
    if (!token) return null;
    return new PlexTvClient(token, config);
  }, [token, config]);
}

/**
 * Hook to fetch Plex servers
 */
export function usePlexServers(token: string | null) {
  const client = usePlexTvClient(token);

  return useQuery({
    queryKey: plexQueryKeys.servers(),
    queryFn: async () => {
      if (!client) throw new Error("No Plex client available");
      return client.getServers();
    },
    enabled: !!client,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch Plex user info
 */
export function usePlexUserInfo(token: string | null) {
  const client = usePlexTvClient(token);

  return useQuery({
    queryKey: plexQueryKeys.userInfo(),
    queryFn: async () => {
      if (!client) throw new Error("No Plex client available");
      return client.getUserInfo();
    },
    enabled: !!client,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

/* ────────────────────────────────────────────────────────────
   PlexServerClient Hooks
   ──────────────────────────────────────────────────────────── */

/**
 * Hook to create a PlexServerClient instance
 */
export function usePlexServerClient(
  server: PlexDevice | null,
  token: string | null,
  config: PlexConfig = DEFAULT_PLEX_CONFIG,
): PlexServerClient | null {
  return useMemo(() => {
    if (!server || !token) return null;
    return new PlexServerClient(server, token, config);
  }, [server, token, config]);
}

/**
 * Hook to fetch media providers for a server
 */
export function useMediaProviders(server: PlexDevice | null, token: string | null) {
  const client = usePlexServerClient(server, token);

  return useQuery({
    queryKey: plexQueryKeys.mediaProviders(server?.clientIdentifier ?? ""),
    queryFn: async () => {
      if (!client) throw new Error("No server client available");
      return client.getMediaProviders();
    },
    enabled: !!client && !!server,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch library sections for a server
 */
export function useLibrarySections<T = unknown>(server: PlexDevice | null, token: string | null) {
  const client = usePlexServerClient(server, token);

  return useQuery<T>({
    queryKey: plexQueryKeys.librarySections(server?.clientIdentifier ?? ""),
    queryFn: async () => {
      if (!client) throw new Error("No server client available");
      return client.getLibrarySections<T>();
    },
    enabled: !!client && !!server,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch library content by section ID
 */
export function useLibraryContent<T = unknown>(
  server: PlexDevice | null,
  token: string | null,
  sectionId: string | null,
) {
  const client = usePlexServerClient(server, token);

  return useQuery<T>({
    queryKey: plexQueryKeys.libraryContent(server?.clientIdentifier ?? "", sectionId ?? ""),
    queryFn: async () => {
      if (!client) throw new Error("No server client available");
      if (!sectionId) throw new Error("No section ID provided");
      return client.getLibraryContent<T>(sectionId);
    },
    enabled: !!client && !!server && !!sectionId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch Continue Watching data
 */
export function useContinueWatching(
  server: PlexDevice | null,
  token: string | null,
): {
  data: ContinueWatchingResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const client = usePlexServerClient(server, token);

  const query = useQuery({
    queryKey: plexQueryKeys.continueWatching(server?.clientIdentifier ?? ""),
    queryFn: async () => {
      if (!client) throw new Error("No server client available");
      return client.getAllContinueWatching();
    },
    enabled: !!client && !!server,
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: true,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook to search media on a server
 */
export function useSearch(
  server: PlexDevice | null,
  token: string | null,
  params: SearchParams | null,
): {
  data: SearchResponse | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const client = usePlexServerClient(server, token);

  const query = useQuery({
    queryKey: plexQueryKeys.search(server?.clientIdentifier ?? "", params?.query ?? ""),
    queryFn: async () => {
      if (!client) throw new Error("No server client available");
      if (!params) throw new Error("No search params provided");
      return client.search(params);
    },
    enabled: !!client && !!server && !!params && params.query.length > 0,
    staleTime: 30 * 1000, // 30 seconds
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * Hook to create a play queue
 */
export function useCreatePlayQueue(server: PlexDevice | null, token: string | null) {
  const client = usePlexServerClient(server, token);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreatePlayQueueParams): Promise<PlayQueueResponse> => {
      if (!client) throw new Error("No server client available");
      return client.createPlayQueue(params);
    },
    onSuccess: (data) => {
      // Cache the play queue
      if (server) {
        queryClient.setQueryData(
          plexQueryKeys.playQueue(
            server.clientIdentifier,
            data.MediaContainer.playQueueID.toString(),
          ),
          data,
        );
      }
    },
  });
}

/**
 * Hook to fetch a play queue by ID
 */
export function usePlayQueue(
  server: PlexDevice | null,
  token: string | null,
  playQueueId: string | null,
) {
  const client = usePlexServerClient(server, token);

  return useQuery({
    queryKey: plexQueryKeys.playQueue(server?.clientIdentifier ?? "", playQueueId ?? ""),
    queryFn: async () => {
      if (!client) throw new Error("No server client available");
      if (!playQueueId) throw new Error("No play queue ID provided");
      return client.getPlayQueue(playQueueId);
    },
    enabled: !!client && !!server && !!playQueueId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to send timeline updates (for tracking playback progress)
 */
export function useSendTimeline(server: PlexDevice | null, token: string | null) {
  const client = usePlexServerClient(server, token);

  return useMutation({
    mutationFn: async (params: {
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
    }): Promise<void> => {
      if (!client) throw new Error("No server client available");
      return client.sendTimeline(params);
    },
  });
}

/* ────────────────────────────────────────────────────────────
   Utility Hooks
   ──────────────────────────────────────────────────────────── */

/**
 * Hook to invalidate all Plex-related queries
 */
export function useInvalidatePlexQueries() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: plexQueryKeys.all });
  };
}

/**
 * Hook to invalidate queries for a specific server
 */
export function useInvalidateServerQueries(serverId: string) {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: plexQueryKeys.server(serverId) });
  };
}
