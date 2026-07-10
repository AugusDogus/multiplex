import { useCallback, useMemo, useState } from "react";
// Value import required for `typeof extractAllSources` in MediaProviders.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- typeof Parameters needs a value
import { extractAllSources, type PlexDevice } from "@multiplex/plex-query";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Option from "effect/Option";

import { isAsyncResultLoading } from "~/lib/effect/async-result";
import type { ServerLibrariesEntry } from "~/lib/effect/plex-boundary";
import { serverLibrariesAtom } from "~/lib/effect/plex-browse-atoms";

/** Matches `extractAllSources` input; bridge entry types `mediaProviders` as unknown. */
type MediaProviders = Parameters<typeof extractAllSources>[0];

export type ServerLibraryData = {
  readonly serverId: string;
  readonly serverName: string;
  readonly serverOwned: boolean;
  readonly mediaProviders: MediaProviders | undefined;
  readonly error: string | undefined;
};

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

function asServerLibraryData(entry: ServerLibrariesEntry): ServerLibraryData {
  return {
    serverId: entry.serverId,
    serverName: entry.serverName,
    serverOwned: entry.serverOwned,
    mediaProviders: entry.mediaProviders as MediaProviders | undefined,
    error: entry.error,
  };
}

export function useServerLibraries(
  servers: PlexDevice[],
): UseServerLibrariesReturn {
  const [retryingServers, setRetryingServers] = useState<Set<string>>(
    new Set(),
  );
  const librariesResult = useAtomValue(serverLibrariesAtom);
  const refreshLibraries = useAtomRefresh(serverLibrariesAtom);

  const libraries = Option.getOrElse(
    AsyncResult.value(librariesResult),
    (): ServerLibrariesEntry[] => [],
  );
  const queryError = Option.getOrUndefined(AsyncResult.error(librariesResult));
  const queryErrorMessage =
    queryError instanceof Error
      ? queryError.message
      : queryError != null
        ? String(queryError)
        : null;
  const isLoading = isAsyncResultLoading(librariesResult);

  // Transform the consolidated results into individual server states
  const serverStates = useMemo(() => {
    const states = new Map<string, ServerLibraryState>();

    // Initialize states for all servers
    servers.forEach((server) => {
      const serverId = server.clientIdentifier;
      const isRetrying = retryingServers.has(serverId);

      // Find this server's data in the consolidated response
      const serverData = libraries.find(
        (result) => result.serverId === serverId,
      );

      states.set(serverId, {
        data: serverData ? asServerLibraryData(serverData) : null,
        error: serverData?.error ?? queryErrorMessage ?? null,
        isLoading: isLoading && !isRetrying,
        isRetrying,
      });
    });

    return states;
  }, [servers, libraries, queryErrorMessage, isLoading, retryingServers]);

  const retryServer = useCallback(
    (serverId: string) => {
      setRetryingServers((prev) => new Set([...prev, serverId]));

      // Retry the entire query since we can't retry individual servers.
      // Refresh is sync; clear the retrying flag on the next microtask so the
      // isRetrying UI still paints for this click.
      try {
        refreshLibraries();
      } catch (error) {
        console.error(`Failed to retry server ${serverId}:`, error);
      } finally {
        queueMicrotask(() => {
          setRetryingServers((prev) => {
            const newSet = new Set(prev);
            newSet.delete(serverId);
            return newSet;
          });
        });
      }
    },
    [refreshLibraries],
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
