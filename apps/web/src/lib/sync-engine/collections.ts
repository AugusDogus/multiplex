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
import {
  browsePageRowKey,
  itemPlaylistsRowKey,
  libraryFilterValuesRowKey,
  mediaItemRowKey,
  playQueueRowKey,
  playlistContentsRowKey,
  playlistRowKey,
  searchResultsRowKey,
} from "./keys";
import { SYNC_ENGINE_SCHEMA_VERSION } from "./persistence";
import {
  sanitizeBrowsePageItems,
  sanitizeContinueWatchingItem,
  sanitizeHomeHub,
  sanitizeLibraryHubsSnapshot,
  sanitizeMediaItemDetails,
  sanitizeServer,
  sanitizeServerLibrary,
  sanitizeUserInfo,
  sanitizeWatchTogetherInvitee,
  sanitizeWatchTogetherRoom,
  stripCredentialFields,
  type SanitizedBrowsePageRow,
  type SanitizedContinueWatchingRow,
  type SanitizedHomeHubRow,
  type SanitizedItemPlaylistsRow,
  type SanitizedLibraryFilterValuesRow,
  type SanitizedLibraryHubsSnapshotRow,
  type SanitizedMediaItemRow,
  type SanitizedPlayQueueRow,
  type SanitizedPlaylistContentsRow,
  type SanitizedPlaylistRow,
  type SanitizedSearchResultsRow,
  type SanitizedServerLibraryRow,
  type SanitizedServerRow,
  type SanitizedUserInfoRow,
  type SanitizedWatchTogetherInviteeRow,
  type SanitizedWatchTogetherRoomRow,
} from "./sanitize";

type QueryCollectionUtilsLike = {
  refetch?: () => Promise<unknown>;
  writeUpsert?: (data: unknown) => void;
  writeDelete?: (key: string | number) => void;
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
  watchTogetherRooms: SyncedCollection<SanitizedWatchTogetherRoomRow>;
  userInfo: SyncedCollection<SanitizedUserInfoRow>;
  watchTogetherInvitees: SyncedCollection<SanitizedWatchTogetherInviteeRow>;
  libraryHubs: SyncedCollection<SanitizedLibraryHubsSnapshotRow>;
  browsePages: SyncedCollection<SanitizedBrowsePageRow>;
  searchResults: SyncedCollection<SanitizedSearchResultsRow>;
  playlists: SyncedCollection<SanitizedPlaylistRow>;
  playlistContents: SyncedCollection<SanitizedPlaylistContentsRow>;
  itemPlaylists: SyncedCollection<SanitizedItemPlaylistsRow>;
  libraryFilterValues: SyncedCollection<SanitizedLibraryFilterValuesRow>;
  playQueues: SyncedCollection<SanitizedPlayQueueRow>;
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
  // optional `schema`; cast once at this factory boundary.
  return createCollection(options as never) as Collection<T, string> & {
    utils: QueryCollectionUtilsLike;
  };
}

function createOnDemandCollection<T extends { id: string }>(config: {
  queryClient: QueryClient;
  persistence: PersistedCollectionPersistence;
  id: string;
  queryKey: string[];
}): SyncedCollection<T> {
  return createPersistedQueryCollection<T>({
    persistence: config.persistence,
    queryOptions: queryCollectionOptions({
      id: config.id,
      queryClient: config.queryClient,
      queryKey: config.queryKey,
      queryFn: async (): Promise<T[]> => [],
      getKey: (row) => row.id,
      syncMode: "on-demand",
      enabled: false,
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
    }),
  });
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
        return hubs.map((hub) => {
          const row = sanitizeHomeHub(
            hub as unknown as Record<string, unknown>,
          );
          for (const item of hub.items) {
            rememberItemConnection(`${hub.serverId}:${item.ratingKey}`, {
              serverUrl: item.serverUrl,
              authToken: item.authToken,
            });
          }
          return row;
        });
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

function createWatchTogetherRoomsCollection(
  queryClient: QueryClient,
  trpc: TRPCClient<AppRouter>,
  persistence: PersistedCollectionPersistence,
) {
  return createPersistedQueryCollection<SanitizedWatchTogetherRoomRow>({
    persistence,
    queryOptions: queryCollectionOptions({
      id: "plex-watch-together-rooms",
      queryClient,
      queryKey: ["sync-engine", "plex", "getWatchTogetherRooms"],
      queryFn: async (): Promise<SanitizedWatchTogetherRoomRow[]> => {
        const rooms = await trpc.plex.getWatchTogetherRooms.query();
        return rooms.map((room) =>
          sanitizeWatchTogetherRoom(room as unknown as Record<string, unknown>),
        );
      },
      getKey: (row) => row.id,
      syncMode: "eager",
      staleTime: 10_000,
      refetchInterval: 10_000,
      refetchOnWindowFocus: false,
    }),
  });
}

function createUserInfoCollection(
  queryClient: QueryClient,
  trpc: TRPCClient<AppRouter>,
  persistence: PersistedCollectionPersistence,
) {
  return createPersistedQueryCollection<SanitizedUserInfoRow>({
    persistence,
    queryOptions: queryCollectionOptions({
      id: "plex-user-info",
      queryClient,
      queryKey: ["sync-engine", "plex", "getUserInfo"],
      queryFn: async (): Promise<SanitizedUserInfoRow[]> => {
        const user = await trpc.plex.getUserInfo.query();
        return [sanitizeUserInfo(user as unknown as Record<string, unknown>)];
      },
      getKey: (row) => row.id,
      syncMode: "eager",
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    }),
  });
}

/**
 * On-demand media item cache. Rows are written when hover-prefetch / details /
 * Effect adapters call `warmMediaItem` / `warmItemMetadata`.
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
    watchTogetherRooms: createWatchTogetherRoomsCollection(
      queryClient,
      trpc,
      persistence,
    ),
    userInfo: createUserInfoCollection(queryClient, trpc, persistence),
    watchTogetherInvitees: createOnDemandCollection({
      queryClient,
      persistence,
      id: "plex-watch-together-invitees",
      queryKey: ["sync-engine", "plex", "watchTogetherInvitees"],
    }),
    libraryHubs: createOnDemandCollection({
      queryClient,
      persistence,
      id: "plex-library-hubs",
      queryKey: ["sync-engine", "plex", "libraryHubs"],
    }),
    browsePages: createOnDemandCollection({
      queryClient,
      persistence,
      id: "plex-browse-pages",
      queryKey: ["sync-engine", "plex", "browsePages"],
    }),
    searchResults: createOnDemandCollection({
      queryClient,
      persistence,
      id: "plex-search-results",
      queryKey: ["sync-engine", "plex", "searchResults"],
    }),
    playlists: createOnDemandCollection({
      queryClient,
      persistence,
      id: "plex-playlists",
      queryKey: ["sync-engine", "plex", "playlists"],
    }),
    playlistContents: createOnDemandCollection({
      queryClient,
      persistence,
      id: "plex-playlist-contents",
      queryKey: ["sync-engine", "plex", "playlistContents"],
    }),
    itemPlaylists: createOnDemandCollection({
      queryClient,
      persistence,
      id: "plex-item-playlists",
      queryKey: ["sync-engine", "plex", "itemPlaylists"],
    }),
    libraryFilterValues: createOnDemandCollection({
      queryClient,
      persistence,
      id: "plex-library-filter-values",
      queryKey: ["sync-engine", "plex", "libraryFilterValues"],
    }),
    playQueues: createOnDemandCollection({
      queryClient,
      persistence,
      id: "plex-play-queues",
      queryKey: ["sync-engine", "plex", "playQueues"],
    }),
  };
}

function rememberHubItemConnections(
  hubs: Array<{
    serverId: string;
    items: Array<{
      ratingKey: string;
      serverUrl?: string;
      authToken?: string;
    }>;
  }>,
): void {
  for (const hub of hubs) {
    for (const item of hub.items) {
      rememberItemConnection(`${hub.serverId}:${item.ratingKey}`, {
        serverUrl: item.serverUrl,
        authToken: item.authToken,
      });
    }
  }
}

export async function warmMediaItem(
  collections: SyncEngineCollections,
  trpc: TRPCClient<AppRouter>,
  input: { serverId: string; ratingKey: string },
): Promise<SanitizedMediaItemRow | null> {
  const details = await trpc.plex.getItemDetails.query(input);
  if (!details) return null;
  rememberItemConnection(mediaItemRowKey(input.serverId, input.ratingKey), {
    serverUrl: details.serverUrl ?? undefined,
    authToken: details.authToken ?? undefined,
  });
  const row = sanitizeMediaItemDetails(
    details as unknown as Record<string, unknown>,
    input.serverId,
    { hasFullDetails: true },
  );
  if (!row) return null;
  collections.mediaItems.utils.writeUpsert?.(row);
  return row;
}

export async function warmItemMetadata(
  collections: SyncEngineCollections,
  trpc: TRPCClient<AppRouter>,
  input: { serverId: string; ratingKey: string },
): Promise<SanitizedMediaItemRow | null> {
  const metadata = await trpc.plex.getItemMetadata.query(input);
  if (!metadata) return null;
  const existing = collections.mediaItems.get(
    mediaItemRowKey(input.serverId, input.ratingKey),
  );
  const row = sanitizeMediaItemDetails(
    {
      item: metadata,
      serverName: existing?.serverName ?? null,
      children: existing?.children ?? [],
      playableChildren: existing?.playableChildren ?? [],
      playTarget: existing?.playTarget ?? null,
    },
    input.serverId,
    { hasFullDetails: existing?.hasFullDetails ?? false },
  );
  if (!row) return null;
  collections.mediaItems.utils.writeUpsert?.(row);
  return row;
}

export async function warmWatchTogetherInvitees(
  collections: SyncEngineCollections,
  trpc: TRPCClient<AppRouter>,
): Promise<SanitizedWatchTogetherInviteeRow[]> {
  const invitees = await trpc.plex.getWatchTogetherInvitees.query();
  const rows = invitees.map((invitee) =>
    sanitizeWatchTogetherInvitee(invitee as unknown as Record<string, unknown>),
  );
  for (const row of rows) {
    collections.watchTogetherInvitees.utils.writeUpsert?.(row);
  }
  return rows;
}

export async function warmWatchTogetherRoom(
  collections: SyncEngineCollections,
  trpc: TRPCClient<AppRouter>,
  roomId: string,
): Promise<SanitizedWatchTogetherRoomRow | null> {
  const room = await trpc.plex.getWatchTogetherRoom.query({ roomId });
  if (!room) return null;
  const row = sanitizeWatchTogetherRoom(
    room as unknown as Record<string, unknown>,
  );
  collections.watchTogetherRooms.utils.writeUpsert?.(row);
  return row;
}

export async function warmLibraryHubs(
  collections: SyncEngineCollections,
  trpc: TRPCClient<AppRouter>,
  input: { machineIdentifier: string; sectionId: string },
): Promise<SanitizedLibraryHubsSnapshotRow> {
  const hubs = await trpc.plex.getLibraryHubs.query(input);
  rememberHubItemConnections(hubs);
  const row = sanitizeLibraryHubsSnapshot(
    input.machineIdentifier,
    input.sectionId,
    hubs as unknown as Record<string, unknown>[],
  );
  collections.libraryHubs.utils.writeUpsert?.(row);
  return row;
}

export function writeBrowsePage(
  collections: SyncEngineCollections,
  input: {
    contentKey: string;
    pageSize: number;
    pageIndex: number;
    totalSize: number;
    items: Array<Record<string, unknown>>;
  },
): SanitizedBrowsePageRow {
  for (const item of input.items) {
    const serverId =
      typeof item.serverId === "string" ? item.serverId : undefined;
    const ratingKey =
      typeof item.ratingKey === "string" ? item.ratingKey : undefined;
    if (serverId && ratingKey) {
      rememberItemConnection(`${serverId}:${ratingKey}`, {
        serverUrl:
          typeof item.serverUrl === "string" ? item.serverUrl : undefined,
        authToken:
          typeof item.authToken === "string" ? item.authToken : undefined,
      });
    }
  }

  const row: SanitizedBrowsePageRow = {
    id: browsePageRowKey(input.contentKey, input.pageSize, input.pageIndex),
    contentKey: input.contentKey,
    pageSize: input.pageSize,
    pageIndex: input.pageIndex,
    totalSize: input.totalSize,
    items: sanitizeBrowsePageItems(input.items),
  };
  collections.browsePages.utils.writeUpsert?.(row);
  return row;
}

function stripCredentialsDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripCredentialsDeep(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const serverId = typeof record.serverId === "string" ? record.serverId : null;
  const ratingKey =
    typeof record.ratingKey === "string" ? record.ratingKey : null;
  if (serverId && ratingKey) {
    rememberItemConnection(`${serverId}:${ratingKey}`, {
      serverUrl:
        typeof record.serverUrl === "string" ? record.serverUrl : undefined,
      authToken:
        typeof record.authToken === "string" ? record.authToken : undefined,
    });
  }
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (
      key === "authToken" ||
      key === "accessToken" ||
      key === "serverUrl" ||
      key === "plexAuthToken" ||
      key === "token" ||
      key === "X-Plex-Token"
    ) {
      continue;
    }
    next[key] = stripCredentialsDeep(entry);
  }
  return next;
}

export async function warmSearchResults(
  collections: SyncEngineCollections,
  trpc: TRPCClient<AppRouter>,
  query: string,
): Promise<SanitizedSearchResultsRow | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const results = await trpc.plex.search.query({ query: trimmed });
  const row: SanitizedSearchResultsRow = {
    id: searchResultsRowKey(trimmed),
    query: trimmed,
    payload: stripCredentialsDeep(results),
  };
  collections.searchResults.utils.writeUpsert?.(row);
  return row;
}

export async function warmPlaylist(
  collections: SyncEngineCollections,
  trpc: TRPCClient<AppRouter>,
  input: { serverId: string; playlistRatingKey: string },
): Promise<SanitizedPlaylistRow> {
  const playlist = await trpc.plex.getPlaylist.query(input);
  const row: SanitizedPlaylistRow = {
    id: playlistRowKey(input.serverId, input.playlistRatingKey),
    serverId: input.serverId,
    playlistRatingKey: input.playlistRatingKey,
    payload: stripCredentialFields(playlist),
  };
  collections.playlists.utils.writeUpsert?.(row);
  return row;
}

export async function warmPlaylistContents(
  collections: SyncEngineCollections,
  trpc: TRPCClient<AppRouter>,
  input: {
    serverId: string;
    playlistRatingKey: string;
    start: number;
    size: number;
  },
): Promise<SanitizedPlaylistContentsRow> {
  const contents = await trpc.plex.getPlaylistContents.query(input);
  const row: SanitizedPlaylistContentsRow = {
    id: playlistContentsRowKey(
      input.serverId,
      input.playlistRatingKey,
      input.start,
      input.size,
    ),
    serverId: input.serverId,
    playlistRatingKey: input.playlistRatingKey,
    start: input.start,
    size: input.size,
    payload: stripCredentialFields(contents),
  };
  collections.playlistContents.utils.writeUpsert?.(row);
  return row;
}

export async function warmItemPlaylists(
  collections: SyncEngineCollections,
  trpc: TRPCClient<AppRouter>,
  input: { serverId: string; playlistType: "video" | "audio" | "photo" },
): Promise<SanitizedItemPlaylistsRow> {
  const playlists = await trpc.plex.getItemPlaylists.query(input);
  const row: SanitizedItemPlaylistsRow = {
    id: itemPlaylistsRowKey(input.serverId, input.playlistType),
    serverId: input.serverId,
    playlistType: input.playlistType,
    payload: stripCredentialFields(playlists),
  };
  collections.itemPlaylists.utils.writeUpsert?.(row);
  return row;
}

export async function warmLibraryFilterValues(
  collections: SyncEngineCollections,
  trpc: TRPCClient<AppRouter>,
  input: { machineIdentifier: string; filterPath: string },
): Promise<SanitizedLibraryFilterValuesRow> {
  const values = await trpc.plex.getLibraryFilterValues.query(input);
  const row: SanitizedLibraryFilterValuesRow = {
    id: libraryFilterValuesRowKey(input.machineIdentifier, input.filterPath),
    machineIdentifier: input.machineIdentifier,
    filterPath: input.filterPath,
    values: Array.isArray(values) ? values : [],
  };
  collections.libraryFilterValues.utils.writeUpsert?.(row);
  return row;
}

export async function warmPlayQueue(
  collections: SyncEngineCollections,
  trpc: TRPCClient<AppRouter>,
  input: {
    serverId: string;
    playQueueId: string;
    includeMarkers?: boolean;
  },
): Promise<SanitizedPlayQueueRow> {
  const queue = await trpc.plex.getPlayQueue.query(input);
  const row: SanitizedPlayQueueRow = {
    id: playQueueRowKey(input.serverId, input.playQueueId),
    serverId: input.serverId,
    playQueueId: input.playQueueId,
    payload: stripCredentialFields(queue),
  };
  collections.playQueues.utils.writeUpsert?.(row);
  return row;
}

export function writeSyncedUserInfo(
  collections: SyncEngineCollections,
  user: Record<string, unknown>,
): SanitizedUserInfoRow {
  const row = sanitizeUserInfo(user);
  collections.userInfo.utils.writeUpsert?.(row);
  return row;
}

export function removeSyncedWatchTogetherRoom(
  collections: SyncEngineCollections,
  roomId: string,
): void {
  collections.watchTogetherRooms.utils.writeDelete?.(roomId);
}
