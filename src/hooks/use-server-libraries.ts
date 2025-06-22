import { useCallback, useMemo, useState } from "react";
import type { PlexDevice } from "~/lib/plex.tv/schemas";
import type { plexRouterOutputs } from "~/server/api/routers/plex";
import { api } from "~/trpc/react";

export interface ServerLibraryState {
  data: plexRouterOutputs["getServerLibraries"] | null;
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
): UseServerLibrariesReturn {
  const [retryingServers, setRetryingServers] = useState<Set<string>>(
    new Set(),
  );
  const utils = api.useUtils();

  // Create queries for all servers
  const serverQueries = servers.map((server) => ({
    serverId: server.clientIdentifier,
    query: api.plex.getServerLibraries.useQuery(
      { serverId: server.clientIdentifier },
      {
        staleTime: 5 * 60 * 1000,
        retry: 1,
        retryDelay: 1000,
      },
    ),
  }));

  // Transform query results into server states
  const serverStates = useMemo(() => {
    const states = new Map<string, ServerLibraryState>();

    serverQueries.forEach(({ serverId, query }) => {
      const isRetrying = retryingServers.has(serverId);

      states.set(serverId, {
        data: query.data ?? null,
        error: query.error?.message ?? null,
        isLoading: query.isLoading && !isRetrying,
        isRetrying,
      });
    });

    return states;
  }, [serverQueries, retryingServers]);

  const retryServer = useCallback(
    (serverId: string) => {
      setRetryingServers((prev) => new Set([...prev, serverId]));

      utils.plex.getServerLibraries
        .fetch({ serverId })
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
    },
    [utils.plex.getServerLibraries],
  );

  const isAnyLoading = useMemo(
    () => Array.from(serverStates.values()).some((state) => state.isLoading),
    [serverStates],
  );

  const hasAnyData = useMemo(
    () =>
      Array.from(serverStates.values()).some(
        (state) => state.data && !state.error,
      ),
    [serverStates],
  );

  return {
    serverStates,
    retryServer,
    isAnyLoading,
    hasAnyData,
  };
}
