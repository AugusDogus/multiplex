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
  const [retryErrors, setRetryErrors] = useState<Map<string, string>>(
    new Map(),
  );
  const collections = useSyncEngineCollections();
  const {
    data: libraryRows,
    isLoading,
    isReady,
    error: syncError,
  } = useSyncedServerLibraries();

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

  const syncErrorMessage = syncError?.message ?? null;

  const serverStates = (() => {
    const states = new Map<string, ServerLibraryState>();

    for (const server of servers) {
      const serverId = server.clientIdentifier;
      const isRetrying = retryingServers.has(serverId);
      const serverData = serverDataById.get(serverId);
      const retryError = retryErrors.get(serverId) ?? null;
      const error =
        serverData?.error ??
        retryError ??
        (!serverData && syncErrorMessage ? syncErrorMessage : null);

      states.set(serverId, {
        data: serverData ?? null,
        error,
        isLoading:
          (!isReady || isLoading) && !isRetrying && !serverData && !error,
        isRetrying,
      });
    }

    return states;
  })();

  const retryServer = (serverId: string) => {
    setRetryingServers((prev) => new Set([...prev, serverId]));
    setRetryErrors((prev) => {
      if (!prev.has(serverId)) return prev;
      const next = new Map(prev);
      next.delete(serverId);
      return next;
    });

    const refetch = collections?.serverLibraries.utils.refetch;
    void Promise.resolve(refetch?.())
      .catch((error: Error) => {
        console.error(`Failed to retry server ${serverId}:`, error);
        setRetryErrors((prev) => {
          const next = new Map(prev);
          next.set(
            serverId,
            error instanceof Error ? error.message : "Failed to load libraries",
          );
          return next;
        });
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
