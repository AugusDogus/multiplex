import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  PlexServerClient,
  plexKeys,
  getPlexConfig,
  type PlexDevice,
  type MediaContainer,
} from "@multiplex/plex-query";

export interface ServerLibraryData {
  serverId: string;
  serverName: string;
  mediaProviders: MediaContainer;
  error?: string;
}

export interface ServerLibraryState {
  data: ServerLibraryData | null;
  error: string | null;
  isLoading: boolean;
  isRetrying: boolean;
}

export interface UseServerLibrariesReturn {
  serverStates: Map<string, ServerLibraryState>;
  retryServer: (serverId: string) => void;
  isAnyLoading: boolean;
  hasAnyData: boolean;
}

export function useServerLibraries(
  servers: PlexDevice[],
  token: string | null,
): UseServerLibrariesReturn {
  const [retryingServers, setRetryingServers] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  // Use useQueries to fetch media providers from all servers in parallel
  const queries = useQueries({
    queries: servers.map((server) => ({
      queryKey: plexKeys.mediaProviders(server.clientIdentifier),
      queryFn: async (): Promise<ServerLibraryData> => {
        if (!token) throw new Error("No auth token");
        const client = new PlexServerClient(server, token, getPlexConfig());
        const mediaProviders = await client.getMediaProviders();
        return {
          serverId: server.clientIdentifier,
          serverName: server.name,
          mediaProviders,
        };
      },
      enabled: !!token && servers.length > 0,
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
      retryDelay: 1000,
    })),
  });

  // Transform the query results into server states
  const serverStates = useMemo(() => {
    const states = new Map<string, ServerLibraryState>();

    servers.forEach((server, index) => {
      const serverId = server.clientIdentifier;
      const query = queries[index];
      const isRetrying = retryingServers.has(serverId);

      if (!query) {
        states.set(serverId, {
          data: null,
          error: null,
          isLoading: true,
          isRetrying: false,
        });
        return;
      }

      states.set(serverId, {
        data: query.data ?? null,
        error: query.error?.message ?? null,
        isLoading: query.isLoading && !isRetrying,
        isRetrying,
      });
    });

    return states;
  }, [servers, queries, retryingServers]);

  const retryServer = useCallback(
    (serverId: string) => {
      setRetryingServers((prev) => new Set([...prev, serverId]));

      // Find the server and refetch
      const server = servers.find((s) => s.clientIdentifier === serverId);
      if (server) {
        queryClient
          .refetchQueries({
            queryKey: plexKeys.mediaProviders(serverId),
          })
          .then(() => {
            setRetryingServers((prev) => {
              const newSet = new Set(prev);
              newSet.delete(serverId);
              return newSet;
            });
          })
          .catch((error: Error) => {
            console.error(`Failed to retry server ${serverId}:`, error);
            setRetryingServers((prev) => {
              const newSet = new Set(prev);
              newSet.delete(serverId);
              return newSet;
            });
          });
      }
    },
    [servers, queryClient],
  );

  const isAnyLoading = useMemo(
    () => Array.from(serverStates.values()).some((state) => state.isLoading),
    [serverStates],
  );

  const hasAnyData = useMemo(
    () => Array.from(serverStates.values()).some((state) => state.data && !state.error),
    [serverStates],
  );

  return {
    serverStates,
    retryServer,
    isAnyLoading,
    hasAnyData,
  };
}
