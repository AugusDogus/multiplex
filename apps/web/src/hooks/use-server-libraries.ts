import { useCallback, useMemo, useState } from "react";
import type { PlexDevice } from "@multiplex/plex-query";
import type { plexRouterOutputs } from "~/server/api/routers/plex";
import { api } from "~/trpc/react";

export interface ServerLibraryState {
  data: plexRouterOutputs["getAllServerLibraries"][number] | null;
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

  // Use the consolidated getAllServerLibraries query
  const allServerLibrariesQuery = api.plex.getAllServerLibraries.useQuery(
    undefined,
    {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      retryDelay: 1000,
    },
  );
  const { refetch: refetchAllServerLibraries } = allServerLibrariesQuery;

  // Transform the consolidated results into individual server states
  const serverStates = useMemo(() => {
    const states = new Map<string, ServerLibraryState>();
    const serverDataById = new Map<
      string,
      plexRouterOutputs["getAllServerLibraries"][number]
    >();
    for (const result of allServerLibrariesQuery.data ?? []) {
      serverDataById.set(result.serverId, result);
    }

    // Initialize states for all servers
    for (const server of servers) {
      const serverId = server.clientIdentifier;
      const isRetrying = retryingServers.has(serverId);

      // Find this server's data in the consolidated response
      const serverData = serverDataById.get(serverId);

      states.set(serverId, {
        data: serverData ?? null,
        error:
          serverData?.error ?? allServerLibrariesQuery.error?.message ?? null,
        isLoading: allServerLibrariesQuery.isLoading && !isRetrying,
        isRetrying,
      });
    }

    return states;
  }, [
    servers,
    allServerLibrariesQuery.data,
    allServerLibrariesQuery.error,
    allServerLibrariesQuery.isLoading,
    retryingServers,
  ]);

  const retryServer = useCallback(
    (serverId: string) => {
      setRetryingServers((prev) => new Set([...prev, serverId]));

      // Retry the entire query since we can't retry individual servers
      refetchAllServerLibraries({ throwOnError: true })
        .catch((error: Error) => {
          console.error(`Failed to retry server ${serverId}:`, error);
        })
        .finally(() => {
          setRetryingServers((prev) => {
            const newSet = new Set(prev);
            newSet.delete(serverId);
            return newSet;
          });
        });
    },
    [refetchAllServerLibraries],
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
