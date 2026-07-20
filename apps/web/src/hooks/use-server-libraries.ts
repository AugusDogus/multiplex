import { useState } from "react";
import type { PlexDevice } from "@multiplex/plex-query";
import type { plexRouterOutputs } from "~/server/api/routers/plex";
import {
  useSyncedServerLibraries,
  useSyncEngineCollections,
} from "~/lib/sync-engine";

export type ServerLibraryData =
  plexRouterOutputs["getAllServerLibraries"][number];

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
): UseServerLibrariesReturn {
  const [retryingServers, setRetryingServers] = useState<Set<string>>(
    new Set(),
  );
  const collections = useSyncEngineCollections();
  const { data: libraryRows, isLoading, isReady } = useSyncedServerLibraries();

  const serverDataById = new Map<string, ServerLibraryData>();
  for (const row of libraryRows) {
    serverDataById.set(row.serverId, {
      serverId: row.serverId,
      serverName: row.serverName,
      serverOwned: row.serverOwned,
      mediaProviders: row.mediaProviders,
      error: row.error ?? undefined,
    } as ServerLibraryData);
  }

  const serverStates = (() => {
    const states = new Map<string, ServerLibraryState>();

    for (const server of servers) {
      const serverId = server.clientIdentifier;
      const isRetrying = retryingServers.has(serverId);
      const serverData = serverDataById.get(serverId);

      states.set(serverId, {
        data: serverData ?? null,
        error: serverData?.error ?? null,
        isLoading: (!isReady || isLoading) && !isRetrying && !serverData,
        isRetrying,
      });
    }

    return states;
  })();

  const retryServer = (serverId: string) => {
    setRetryingServers((prev) => new Set([...prev, serverId]));

    const refetch = collections?.serverLibraries.utils.refetch;
    void Promise.resolve(refetch?.())
      .catch((error: Error) => {
        console.error(`Failed to retry server ${serverId}:`, error);
      })
      .finally(() => {
        setRetryingServers((prev) => {
          const next = new Set(prev);
          next.delete(serverId);
          return next;
        });
      });
  };

  const isAnyLoading = Array.from(serverStates.values()).some(
    (state) => state.isLoading,
  );

  const hasAnyData = Array.from(serverStates.values()).some(
    (state) => state.data && !state.error,
  );

  return {
    serverStates,
    retryServer,
    isAnyLoading,
    hasAnyData,
  };
}
