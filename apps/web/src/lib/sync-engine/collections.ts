"use client";

import { createCollection, type Collection } from "@tanstack/db";
import {
  persistedCollectionOptions,
  type PersistedCollectionPersistence,
} from "@tanstack/browser-db-sqlite-persistence";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type { QueryClient } from "@tanstack/query-core";
import type { TRPCClient } from "@trpc/client";

import type { AppRouter } from "~/server/api/root";
import { rememberItemConnection } from "./connection-overlay";
import { SYNC_ENGINE_SCHEMA_VERSION } from "./persistence";
import {
  sanitizeContinueWatchingItem,
  sanitizeHomeHub,
  sanitizeMediaItemDetails,
  sanitizeServer,
  sanitizeServerLibrary,
  type SanitizedContinueWatchingRow,
  type SanitizedHomeHubRow,
  type SanitizedMediaItemRow,
  type SanitizedServerLibraryRow,
  type SanitizedServerRow,
} from "./sanitize";

type QueryCollectionUtilsLike = {
  refetch?: () => Promise<unknown>;
  writeUpsert?: (data: unknown) => void;
};

type SyncedCollection<T extends object> = Collection<T, string> & {
  utils: QueryCollectionUtilsLike;
};

export type SyncEngineCollections = {
  servers: SyncedCollection<SanitizedServerRow>;
  continueWatching: SyncedCollection<SanitizedContinueWatchingRow>;
  homeHubs: SyncedCollection<SanitizedHomeHubRow>;
  serverLibraries: SyncedCollection<SanitizedServerLibraryRow>;
  mediaItems: SyncedCollection<SanitizedMediaItemRow>;
};

/**
 * Persistence + query-collection option inference is still awkward in 0.6.x
 * (schema/key generics disagree across packages). Cast at this boundary only.
 */
function createPersistedQueryCollection<T extends object>(config: {
  persistence: PersistedCollectionPersistence;
  queryOptions: object;
}): Collection<T, string> & { utils: QueryCollectionUtilsLike } {
  const options = persistedCollectionOptions({
    persistence: config.persistence,
    schemaVersion: SYNC_ENGINE_SCHEMA_VERSION,
    ...config.queryOptions,
  } as never);
  // Cross-package generics (query-collection ↔ sqlite-persistence) disagree on
  // optional `schema`; spike keeps a single cast at this factory boundary.
  return createCollection(options as never) as Collection<T, string> & {
    utils: QueryCollectionUtilsLike;
  };
}

function createServersCollection(
  queryClient: QueryClient,
  trpc: TRPCClient<AppRouter>,
  persistence: PersistedCollectionPersistence,
) {
  return createPersistedQueryCollection<SanitizedServerRow>({
    persistence,
    queryOptions: queryCollectionOptions({
      id: "plex-servers",
      queryClient,
      queryKey: ["sync-engine", "plex", "getServers"],
      queryFn: async (): Promise<SanitizedServerRow[]> => {
        const servers = await trpc.plex.getServers.query();
        return servers.map((server) =>
          sanitizeServer(server as unknown as Record<string, unknown>),
        );
      },
      getKey: (row) => row.id,
      syncMode: "eager",
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    }),
  });
}

function createContinueWatchingCollection(
  queryClient: QueryClient,
  trpc: TRPCClient<AppRouter>,
  persistence: PersistedCollectionPersistence,
) {
  return createPersistedQueryCollection<SanitizedContinueWatchingRow>({
    persistence,
    queryOptions: queryCollectionOptions({
      id: "plex-continue-watching",
      queryClient,
      queryKey: ["sync-engine", "plex", "getAllContinueWatching"],
      queryFn: async (): Promise<SanitizedContinueWatchingRow[]> => {
        const items = await trpc.plex.getAllContinueWatching.query();
        return items.map((item) => {
          const row = sanitizeContinueWatchingItem(
            item as unknown as Record<string, unknown>,
          );
          rememberItemConnection(row.id, {
            serverUrl: item.serverUrl,
            authToken: item.authToken,
          });
          return row;
        });
      },
      getKey: (row) => row.id,
      syncMode: "eager",
      staleTime: 30_000,
      refetchInterval: 30_000,
      refetchOnWindowFocus: false,
      onUpdate: async ({ transaction }) => {
        await Promise.all(
          transaction.mutations.map(async (mutation) => {
            const row = mutation.modified;
            if (row.isCompleted !== true) return;
            await trpc.plex.setItemWatchedState.mutate({
              serverId: row.serverId,
              ratingKey: row.ratingKey,
              watched: true,
            });
          }),
        );
      },
    }),
  });
}

function createHomeHubsCollection(
  queryClient: QueryClient,
  trpc: TRPCClient<AppRouter>,
  persistence: PersistedCollectionPersistence,
) {
  return createPersistedQueryCollection<SanitizedHomeHubRow>({
    persistence,
    queryOptions: queryCollectionOptions({
      id: "plex-home-hubs",
      queryClient,
      queryKey: ["sync-engine", "plex", "getHomeHubs"],
      queryFn: async (): Promise<SanitizedHomeHubRow[]> => {
        const hubs = await trpc.plex.getHomeHubs.query();
        return hubs.map((hub) =>
          sanitizeHomeHub(hub as unknown as Record<string, unknown>),
        );
      },
      getKey: (row) => row.id,
      syncMode: "eager",
      staleTime: 2 * 60_000,
      refetchOnWindowFocus: false,
    }),
  });
}

function createServerLibrariesCollection(
  queryClient: QueryClient,
  trpc: TRPCClient<AppRouter>,
  persistence: PersistedCollectionPersistence,
) {
  return createPersistedQueryCollection<SanitizedServerLibraryRow>({
    persistence,
    queryOptions: queryCollectionOptions({
      id: "plex-server-libraries",
      queryClient,
      queryKey: ["sync-engine", "plex", "getAllServerLibraries"],
      queryFn: async (): Promise<SanitizedServerLibraryRow[]> => {
        const libraries = await trpc.plex.getAllServerLibraries.query();
        return libraries.map((entry) =>
          sanitizeServerLibrary(entry as unknown as Record<string, unknown>),
        );
      },
      getKey: (row) => row.id,
      syncMode: "eager",
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    }),
  });
}

/**
 * On-demand media item cache. Rows are written when the spike demo (or a
 * future hover-prefetch path) calls `warmMediaItem`.
 */
function createMediaItemsCollection(
  queryClient: QueryClient,
  persistence: PersistedCollectionPersistence,
) {
  return createPersistedQueryCollection<SanitizedMediaItemRow>({
    persistence,
    queryOptions: queryCollectionOptions({
      id: "plex-media-items",
      queryClient,
      queryKey: ["sync-engine", "plex", "mediaItems"],
      queryFn: async (): Promise<SanitizedMediaItemRow[]> => [],
      getKey: (row) => row.id,
      syncMode: "on-demand",
      enabled: false,
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
    }),
  });
}

export function createSyncEngineCollections(options: {
  queryClient: QueryClient;
  trpc: TRPCClient<AppRouter>;
  persistence: PersistedCollectionPersistence;
}): SyncEngineCollections {
  const { queryClient, trpc, persistence } = options;
  return {
    servers: createServersCollection(queryClient, trpc, persistence),
    continueWatching: createContinueWatchingCollection(
      queryClient,
      trpc,
      persistence,
    ),
    homeHubs: createHomeHubsCollection(queryClient, trpc, persistence),
    serverLibraries: createServerLibrariesCollection(
      queryClient,
      trpc,
      persistence,
    ),
    mediaItems: createMediaItemsCollection(queryClient, persistence),
  };
}

export async function warmMediaItem(
  collections: SyncEngineCollections,
  trpc: TRPCClient<AppRouter>,
  input: { serverId: string; ratingKey: string },
): Promise<SanitizedMediaItemRow | null> {
  const details = await trpc.plex.getItemDetails.query(input);
  if (!details) return null;
  const row = sanitizeMediaItemDetails(
    details as unknown as Record<string, unknown>,
    input.serverId,
  );
  if (!row) return null;
  collections.mediaItems.utils.writeUpsert?.(row);
  return row;
}
