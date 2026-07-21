"use client";

import { useEffect, useRef, useState } from "react";

import type { HubWithServer, PlexUserInfo } from "@multiplex/plex-query";
import type { RouterOutputs } from "~/trpc/api";

import {
  warmItemMetadata,
  warmItemPlaylists,
  warmLibraryFilterValues,
  warmLibraryHubs,
  warmMediaItem,
  warmPlaylist,
  warmPlaylistContents,
  warmPlayQueue,
  warmSearchResults,
  warmWatchTogetherInvitees,
  warmWatchTogetherRoom,
  writeSyncedUserInfo,
} from "./collections";
import {
  emptyBrowsePagesCollection,
  emptyContinueWatchingCollection,
  emptyHomeHubsCollection,
  emptyItemPlaylistsCollection,
  emptyLibraryFilterValuesCollection,
  emptyLibraryHubsCollection,
  emptyMediaItemsCollection,
  emptyPlaylistsCollection,
  emptyPlaylistContentsCollection,
  emptyPlayQueuesCollection,
  emptySearchResultsCollection,
  emptyServerLibrariesCollection,
  emptyServersCollection,
  emptyUserInfoCollection,
  emptyWatchTogetherInviteesCollection,
  emptyWatchTogetherRoomsCollection,
} from "./empty-collections";
import { getItemConnection } from "./connection-overlay";
import { toHubWithServer } from "./home-hubs-view";
import { toItemDetails, toItemMetadata } from "./item-details-view";
import {
  itemPlaylistsRowKey,
  libraryFilterValuesRowKey,
  libraryHubsSnapshotKey,
  mediaItemRowKey,
  playQueueRowKey,
  playlistContentsRowKey,
  playlistRowKey,
  searchResultsRowKey,
  USER_INFO_ROW_ID,
} from "./keys";
import { useSyncEngineCollections } from "./provider";
import { useCollectionRowById, useCollectionRows } from "./use-collection-live";
import type {
  SanitizedContinueWatchingRow,
  SanitizedHomeHubRow,
  SanitizedItemPlaylistsRow,
  SanitizedLibraryFilterValuesRow,
  SanitizedLibraryHubsSnapshotRow,
  SanitizedMediaItemRow,
  SanitizedPlayQueueRow,
  SanitizedPlaylistContentsRow,
  SanitizedPlaylistRow,
  SanitizedSearchResultsRow,
  SanitizedServerLibraryRow,
  SanitizedServerRow,
  SanitizedUserInfoRow,
  SanitizedWatchTogetherInviteeRow,
  SanitizedWatchTogetherRoomRow,
} from "./sanitize";
import { getSyncEngineTrpcClient } from "./trpc-client";
import { toPlexUserInfo } from "./user-info-view";
import { toWatchTogetherRoom } from "./watch-together-view";

type ItemDetails = NonNullable<RouterOutputs["plex"]["getItemDetails"]>;

function useWarmOnce(
  key: string | null,
  warm: () => Promise<unknown>,
  enabled: boolean,
): { isWarming: boolean; error: Error | null } {
  const [isWarming, setIsWarming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const warmRef = useRef(warm);
  // Attempt at most once per key so empty results / 404s do not spin forever.
  const attemptedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    warmRef.current = warm;
  }, [warm]);

  useEffect(() => {
    if (!enabled || !key) return;
    if (attemptedKeyRef.current === key) return;
    attemptedKeyRef.current = key;
    let cancelled = false;
    setIsWarming(true);
    setError(null);
    void warmRef
      .current()
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause : new Error("Sync warm failed"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsWarming(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, key]);

  useEffect(() => {
    if (!key) {
      attemptedKeyRef.current = null;
    }
  }, [key]);

  return { isWarming, error };
}

export function useSyncedServers(): {
  data: SanitizedServerRow[];
  isLoading: boolean;
  isReady: boolean;
} {
  const collections = useSyncEngineCollections();
  const { data, isLoading } = useCollectionRows<SanitizedServerRow>(
    collections?.servers ?? emptyServersCollection,
  );

  return {
    data: collections ? data : [],
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
  };
}

export function useSyncedContinueWatching(): {
  data: SanitizedContinueWatchingRow[];
  isLoading: boolean;
  isReady: boolean;
} {
  const collections = useSyncEngineCollections();
  const { data, isLoading } = useCollectionRows<SanitizedContinueWatchingRow>(
    collections?.continueWatching ?? emptyContinueWatchingCollection,
  );

  return {
    data: collections ? data : [],
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
  };
}

export function useSyncedHomeHubs(): {
  data: SanitizedHomeHubRow[];
  isLoading: boolean;
  isReady: boolean;
} {
  const collections = useSyncEngineCollections();
  const { data, isLoading } = useCollectionRows<SanitizedHomeHubRow>(
    collections?.homeHubs ?? emptyHomeHubsCollection,
  );

  return {
    data: collections ? data : [],
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
  };
}

export function useSyncedServerLibraries(): {
  data: SanitizedServerLibraryRow[];
  isLoading: boolean;
  isReady: boolean;
} {
  const collections = useSyncEngineCollections();
  const { data, isLoading } = useCollectionRows<SanitizedServerLibraryRow>(
    collections?.serverLibraries ?? emptyServerLibrariesCollection,
  );

  return {
    data: collections ? data : [],
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
  };
}

export function useSyncedMediaItems(): {
  data: SanitizedMediaItemRow[];
  isLoading: boolean;
  isReady: boolean;
} {
  const collections = useSyncEngineCollections();
  const { data, isLoading } = useCollectionRows<SanitizedMediaItemRow>(
    collections?.mediaItems ?? emptyMediaItemsCollection,
  );

  return {
    data: collections ? data : [],
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
  };
}

export function useSyncedWatchTogetherRooms(): {
  data: SanitizedWatchTogetherRoomRow[];
  rooms: ReturnType<typeof toWatchTogetherRoom>[];
  isLoading: boolean;
  isReady: boolean;
} {
  const collections = useSyncEngineCollections();
  const { data, isLoading } = useCollectionRows<SanitizedWatchTogetherRoomRow>(
    collections?.watchTogetherRooms ?? emptyWatchTogetherRoomsCollection,
  );

  const rows = collections ? data : [];

  return {
    data: rows,
    rooms: rows.map(toWatchTogetherRoom),
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
  };
}

export function useSyncedWatchTogetherRoom(
  roomId: string | null,
  options?: { enabled?: boolean },
): {
  room: ReturnType<typeof toWatchTogetherRoom> | undefined;
  isPending: boolean;
  isError: boolean;
} {
  const enabled = options?.enabled ?? true;
  const collections = useSyncEngineCollections();
  const { data: row, isLoading } =
    useCollectionRowById<SanitizedWatchTogetherRoomRow>(
      collections?.watchTogetherRooms ?? emptyWatchTogetherRoomsCollection,
      enabled ? roomId : null,
    );
  const needsWarm = Boolean(enabled && collections && roomId && !row);
  const { isWarming, error } = useWarmOnce(
    needsWarm ? `room:${roomId}` : null,
    async () => {
      if (!collections || !roomId) return;
      await warmWatchTogetherRoom(
        collections,
        getSyncEngineTrpcClient(),
        roomId,
      );
    },
    needsWarm,
  );

  return {
    room: row ? toWatchTogetherRoom(row) : undefined,
    isPending: Boolean(
      enabled && roomId && (!collections || (!row && (isLoading || isWarming))),
    ),
    isError: Boolean(error),
  };
}

export function useSyncedUserInfo(options?: { initialData?: PlexUserInfo }): {
  data: PlexUserInfo | undefined;
  isLoading: boolean;
  isReady: boolean;
} {
  const collections = useSyncEngineCollections();
  const { data: row, isLoading } = useCollectionRowById<SanitizedUserInfoRow>(
    collections?.userInfo ?? emptyUserInfoCollection,
    USER_INFO_ROW_ID,
  );

  useEffect(() => {
    if (!collections || !options?.initialData) return;
    if (row) return;
    writeSyncedUserInfo(
      collections,
      options.initialData as unknown as Record<string, unknown>,
    );
  }, [collections, options?.initialData, row]);

  return {
    data: row ? toPlexUserInfo(row) : options?.initialData,
    isLoading: !collections || (isLoading && !row && !options?.initialData),
    isReady: Boolean(collections),
  };
}

export function useSyncedItemDetails(
  serverId: string,
  ratingKey: string,
  options?: { enabled?: boolean },
): {
  details: ItemDetails | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
} {
  const enabled = (options?.enabled ?? true) && Boolean(serverId && ratingKey);
  const collections = useSyncEngineCollections();
  const id = mediaItemRowKey(serverId, ratingKey);
  const { data: row, isLoading } = useCollectionRowById<SanitizedMediaItemRow>(
    collections?.mediaItems ?? emptyMediaItemsCollection,
    enabled ? id : null,
  );

  const hasFullDetails = Boolean(row?.hasFullDetails && row.item);
  const missingPlayCredentials = !getItemConnection(id)?.authToken;
  // Re-warm when OPFS has details but the session overlay lost tokens (reload).
  const needsWarm = Boolean(
    enabled && collections && (!hasFullDetails || missingPlayCredentials),
  );
  const { isWarming, error } = useWarmOnce(
    needsWarm ? `details:${id}` : null,
    async () => {
      if (!collections) return;
      await warmMediaItem(collections, getSyncEngineTrpcClient(), {
        serverId,
        ratingKey,
      });
    },
    needsWarm,
  );

  return {
    details:
      hasFullDetails && row ? (toItemDetails(row) ?? undefined) : undefined,
    isPending: Boolean(
      enabled &&
        (!collections ||
          (!hasFullDetails && (isLoading || isWarming)) ||
          (missingPlayCredentials && isWarming && !hasFullDetails)),
    ),
    isFetching: isWarming,
    isError: Boolean(error),
    error,
  };
}

export function useSyncedItemMetadata(
  serverId: string,
  ratingKey: string,
  options?: { enabled?: boolean },
): {
  data: ReturnType<typeof toItemMetadata>;
  refetch: () => Promise<{ data: ReturnType<typeof toItemMetadata> }>;
} {
  const enabled = (options?.enabled ?? true) && Boolean(serverId && ratingKey);
  const collections = useSyncEngineCollections();
  const id = mediaItemRowKey(serverId, ratingKey);
  const { data: row } = useCollectionRowById<SanitizedMediaItemRow>(
    collections?.mediaItems ?? emptyMediaItemsCollection,
    enabled ? id : null,
  );
  const needsWarm = Boolean(enabled && collections && !row?.item);
  useWarmOnce(
    needsWarm ? `metadata:${id}` : null,
    async () => {
      if (!collections) return;
      await warmItemMetadata(collections, getSyncEngineTrpcClient(), {
        serverId,
        ratingKey,
      });
    },
    needsWarm,
  );

  return {
    data: row ? toItemMetadata(row) : null,
    refetch: async () => {
      if (!collections || !enabled) {
        return { data: row ? toItemMetadata(row) : null };
      }
      const warmed = await warmItemMetadata(
        collections,
        getSyncEngineTrpcClient(),
        {
          serverId,
          ratingKey,
        },
      );
      return { data: warmed ? toItemMetadata(warmed) : null };
    },
  };
}

export function useSyncedLibraryHubs(
  machineIdentifier: string,
  sectionId: string,
): {
  hubs: HubWithServer[];
  isPending: boolean;
  isFetching: boolean;
} {
  const collections = useSyncEngineCollections();
  const id = libraryHubsSnapshotKey(machineIdentifier, sectionId);
  const { data: snapshot, isLoading } =
    useCollectionRowById<SanitizedLibraryHubsSnapshotRow>(
      collections?.libraryHubs ?? emptyLibraryHubsCollection,
      id,
    );

  // Always reconcile once per section so hub item credentials refill the
  // session overlay after an OPFS-only reload.
  const { isWarming } = useWarmOnce(
    collections ? `library-hubs:${id}` : null,
    async () => {
      if (!collections) return;
      await warmLibraryHubs(collections, getSyncEngineTrpcClient(), {
        machineIdentifier,
        sectionId,
      });
    },
    Boolean(collections),
  );

  return {
    hubs: snapshot ? snapshot.hubs.map(toHubWithServer) : [],
    isPending: !collections || (!snapshot && (isLoading || isWarming)),
    isFetching: isWarming,
  };
}

export function useSyncedWatchTogetherInvitees(options?: {
  enabled?: boolean;
}): {
  data: SanitizedWatchTogetherInviteeRow[];
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
} {
  const enabled = options?.enabled ?? true;
  const collections = useSyncEngineCollections();
  const { data, isLoading } =
    useCollectionRows<SanitizedWatchTogetherInviteeRow>(
      collections?.watchTogetherInvitees ??
        emptyWatchTogetherInviteesCollection,
    );

  const rows = collections ? data : [];
  const { isWarming, error } = useWarmOnce(
    enabled && collections ? "invitees" : null,
    async () => {
      if (!collections) return;
      await warmWatchTogetherInvitees(collections, getSyncEngineTrpcClient());
    },
    Boolean(enabled && collections),
  );

  const pending = Boolean(
    enabled &&
      (!collections || (rows.length === 0 && (isLoading || isWarming))),
  );

  return {
    data: rows,
    isLoading: pending,
    isPending: pending,
    isError: Boolean(error),
  };
}

export function useSyncedSearchResults(query: string): {
  data: RouterOutputs["plex"]["search"] | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const collections = useSyncEngineCollections();
  const id = searchResultsRowKey(query);
  const enabled = query.trim().length > 0;
  const { data: row } = useCollectionRowById<SanitizedSearchResultsRow>(
    collections?.searchResults ?? emptySearchResultsCollection,
    enabled ? id : null,
  );
  const needsWarm = Boolean(enabled && collections && !row);
  const { isWarming, error } = useWarmOnce(
    needsWarm ? `search:${id}` : null,
    async () => {
      if (!collections) return;
      await warmSearchResults(collections, getSyncEngineTrpcClient(), query);
    },
    needsWarm,
  );

  return {
    data: row?.payload as RouterOutputs["plex"]["search"] | undefined,
    isLoading: Boolean(enabled && (!collections || (!row && isWarming))),
    error,
  };
}

export function useSyncedPlaylist(
  serverId: string,
  playlistRatingKey: string,
): {
  data: RouterOutputs["plex"]["getPlaylist"] | undefined;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<void>;
} {
  const collections = useSyncEngineCollections();
  const id = playlistRowKey(serverId, playlistRatingKey);
  const { data: row } = useCollectionRowById<SanitizedPlaylistRow>(
    collections?.playlists ?? emptyPlaylistsCollection,
    id,
  );
  const needsWarm = Boolean(collections && !row);
  const { isWarming, error } = useWarmOnce(
    needsWarm ? `playlist:${id}` : null,
    async () => {
      if (!collections) return;
      await warmPlaylist(collections, getSyncEngineTrpcClient(), {
        serverId,
        playlistRatingKey,
      });
    },
    needsWarm,
  );

  const pending = !collections || (!row && isWarming);

  return {
    data: row?.payload as RouterOutputs["plex"]["getPlaylist"] | undefined,
    isLoading: pending,
    isPending: pending,
    isError: Boolean(error),
    isFetching: isWarming,
    refetch: async () => {
      if (!collections) return;
      await warmPlaylist(collections, getSyncEngineTrpcClient(), {
        serverId,
        playlistRatingKey,
      });
    },
  };
}

export function useSyncedPlaylistContents(input: {
  serverId: string;
  playlistRatingKey: string;
  start: number;
  size: number;
}): {
  data: RouterOutputs["plex"]["getPlaylistContents"] | undefined;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<void>;
} {
  const collections = useSyncEngineCollections();
  const id = playlistContentsRowKey(
    input.serverId,
    input.playlistRatingKey,
    input.start,
    input.size,
  );
  const { data: row } = useCollectionRowById<SanitizedPlaylistContentsRow>(
    collections?.playlistContents ?? emptyPlaylistContentsCollection,
    id,
  );
  const needsWarm = Boolean(collections && !row);
  const { isWarming, error } = useWarmOnce(
    needsWarm ? `playlist-contents:${id}` : null,
    async () => {
      if (!collections) return;
      await warmPlaylistContents(collections, getSyncEngineTrpcClient(), input);
    },
    needsWarm,
  );

  const pending = !collections || (!row && isWarming);

  return {
    data: row?.payload as
      | RouterOutputs["plex"]["getPlaylistContents"]
      | undefined,
    isLoading: pending,
    isPending: pending,
    isError: Boolean(error),
    isFetching: isWarming,
    refetch: async () => {
      if (!collections) return;
      await warmPlaylistContents(collections, getSyncEngineTrpcClient(), input);
    },
  };
}

export function useSyncedItemPlaylists(
  serverId: string,
  playlistType: "video" | "audio" | "photo" | null | undefined,
  options?: { enabled?: boolean },
): {
  data: RouterOutputs["plex"]["getItemPlaylists"] | undefined;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
} {
  const resolvedType =
    playlistType === "audio" || playlistType === "photo"
      ? playlistType
      : playlistType === "video"
        ? "video"
        : null;
  const enabled = (options?.enabled ?? true) && resolvedType !== null;
  const collections = useSyncEngineCollections();
  const id = itemPlaylistsRowKey(serverId, resolvedType ?? "video");
  const { data: row } = useCollectionRowById<SanitizedItemPlaylistsRow>(
    collections?.itemPlaylists ?? emptyItemPlaylistsCollection,
    enabled ? id : null,
  );
  const needsWarm = Boolean(enabled && collections && !row);
  const { isWarming, error } = useWarmOnce(
    needsWarm ? `item-playlists:${id}` : null,
    async () => {
      if (!collections || !resolvedType) return;
      await warmItemPlaylists(collections, getSyncEngineTrpcClient(), {
        serverId,
        playlistType: resolvedType,
      });
    },
    needsWarm,
  );

  const pending = Boolean(enabled && (!collections || (!row && isWarming)));

  return {
    data: row?.payload as RouterOutputs["plex"]["getItemPlaylists"] | undefined,
    isLoading: pending,
    isPending: pending,
    isError: Boolean(error),
    refetch: async () => {
      if (!collections || !resolvedType) return;
      await warmItemPlaylists(collections, getSyncEngineTrpcClient(), {
        serverId,
        playlistType: resolvedType,
      });
    },
  };
}

export function useSyncedLibraryFilterValues(
  machineIdentifier: string,
  filterPath: string,
  options?: { enabled?: boolean },
): {
  data: RouterOutputs["plex"]["getLibraryFilterValues"] | undefined;
  isLoading: boolean;
} {
  const enabled = options?.enabled ?? true;
  const collections = useSyncEngineCollections();
  const id = libraryFilterValuesRowKey(machineIdentifier, filterPath);
  const { data: row } = useCollectionRowById<SanitizedLibraryFilterValuesRow>(
    collections?.libraryFilterValues ?? emptyLibraryFilterValuesCollection,
    enabled ? id : null,
  );
  const needsWarm = Boolean(enabled && collections && !row);
  const { isWarming } = useWarmOnce(
    needsWarm ? `filter-values:${id}` : null,
    async () => {
      if (!collections) return;
      await warmLibraryFilterValues(collections, getSyncEngineTrpcClient(), {
        machineIdentifier,
        filterPath,
      });
    },
    needsWarm,
  );

  return {
    data: row?.values as
      | RouterOutputs["plex"]["getLibraryFilterValues"]
      | undefined,
    isLoading: Boolean(enabled && (!collections || (!row && isWarming))),
  };
}

export function useSyncedPlayQueue(
  serverId: string,
  playQueueId: string,
  options?: { enabled?: boolean; refetchIntervalMs?: number },
): {
  data: RouterOutputs["plex"]["getPlayQueue"] | undefined;
} {
  const enabled =
    (options?.enabled ?? true) && Boolean(serverId && playQueueId);
  const collections = useSyncEngineCollections();
  const id = playQueueRowKey(serverId, playQueueId);
  const { data: row } = useCollectionRowById<SanitizedPlayQueueRow>(
    collections?.playQueues ?? emptyPlayQueuesCollection,
    enabled ? id : null,
  );

  useEffect(() => {
    if (!enabled || !collections) return;
    let cancelled = false;
    const tick = () => {
      void warmPlayQueue(collections, getSyncEngineTrpcClient(), {
        serverId,
        playQueueId,
        includeMarkers: true,
      }).catch(() => undefined);
    };
    if (!row) tick();
    const intervalMs = options?.refetchIntervalMs ?? 30_000;
    const handle = window.setInterval(() => {
      if (!cancelled) tick();
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [
    collections,
    enabled,
    options?.refetchIntervalMs,
    playQueueId,
    row,
    serverId,
  ]);

  return {
    data: row?.payload as RouterOutputs["plex"]["getPlayQueue"] | undefined,
  };
}

/** Expose empty browse collection for MediaPosterGrid live reads. */
export function useSyncedBrowsePagesCollection() {
  const collections = useSyncEngineCollections();
  return collections?.browsePages ?? emptyBrowsePagesCollection;
}
