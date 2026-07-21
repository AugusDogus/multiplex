"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

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

const WARM_MAX_ATTEMPTS = 3;

function useWarmOnce(
  key: string | null,
  warm: () => Promise<unknown>,
  enabled: boolean,
): { isWarming: boolean; error: Error | null } {
  const [isWarming, setIsWarming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const warmRef = useRef(warm);
  // Track successful/in-flight key so empty results / 404s do not spin forever.
  // Failures clear this and bump `retryNonce` (capped) so credential refill can retry.
  const settledKeyRef = useRef<string | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  const attemptCountRef = useRef(0);

  useEffect(() => {
    warmRef.current = warm;
  }, [warm]);

  useEffect(() => {
    if (!enabled || !key) return;

    if (activeKeyRef.current !== key) {
      activeKeyRef.current = key;
      attemptCountRef.current = 0;
      settledKeyRef.current = null;
    }

    if (settledKeyRef.current === key) return;
    settledKeyRef.current = key;

    let cancelled = false;
    let retryTimer: number | undefined;
    setIsWarming(true);
    setError(null);
    void warmRef
      .current()
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof Error ? cause : new Error("Sync warm failed"),
        );
        // Allow retry after overlay refill / transient network errors.
        settledKeyRef.current = null;
        if (attemptCountRef.current + 1 < WARM_MAX_ATTEMPTS) {
          attemptCountRef.current += 1;
          const delayMs = 400 * attemptCountRef.current;
          retryTimer = window.setTimeout(() => {
            if (!cancelled) setRetryNonce((value) => value + 1);
          }, delayMs);
        }
      })
      .finally(() => {
        if (!cancelled) setIsWarming(false);
      });
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [enabled, key, retryNonce]);

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
  error: Error | null;
} {
  const collections = useSyncEngineCollections();
  const { data, isLoading } = useCollectionRows<SanitizedServerLibraryRow>(
    collections?.serverLibraries ?? emptyServerLibrariesCollection,
  );
  // Observe the Query Collection's underlying query without double-fetching.
  const { error: queryError } = useQuery({
    queryKey: ["sync-engine", "plex", "getAllServerLibraries"],
    queryFn: () => Promise.resolve([] as SanitizedServerLibraryRow[]),
    enabled: false,
  });

  return {
    data: collections ? data : [],
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
    error:
      queryError instanceof Error
        ? queryError
        : queryError
          ? new Error("Failed to sync server libraries")
          : null,
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

  const rows = useMemo(() => (collections ? data : []), [collections, data]);
  const rooms = useMemo(() => rows.map(toWatchTogetherRoom), [rows]);

  return {
    data: rows,
    rooms,
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
  // Stale-while-revalidate: show cached room immediately, always re-check Plex
  // before treating the lobby/session as authoritative.
  const shouldRevalidate = Boolean(enabled && collections && roomId);
  const { isWarming, error } = useWarmOnce(
    shouldRevalidate ? `room:${roomId}` : null,
    async () => {
      if (!collections || !roomId) return;
      await warmWatchTogetherRoom(
        collections,
        getSyncEngineTrpcClient(),
        roomId,
      );
    },
    shouldRevalidate,
  );

  const room = useMemo(
    () => (row ? toWatchTogetherRoom(row) : undefined),
    [row],
  );

  return {
    room,
    isPending: Boolean(
      enabled && roomId && (!collections || (!row && (isLoading || isWarming))),
    ),
    isError: Boolean(error && !row),
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
    writeSyncedUserInfo(collections, options.initialData);
  }, [collections, options?.initialData, row]);

  const data = useMemo(
    () => (row ? toPlexUserInfo(row) : options?.initialData),
    [options?.initialData, row],
  );

  return {
    data,
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

  const details = useMemo(
    () =>
      hasFullDetails && row ? (toItemDetails(row) ?? undefined) : undefined,
    [hasFullDetails, row],
  );

  return {
    details,
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

  const data = useMemo(() => (row ? toItemMetadata(row) : null), [row]);

  return {
    data,
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

  const hubs = useMemo(
    () => (snapshot ? snapshot.hubs.map(toHubWithServer) : []),
    [snapshot],
  );

  return {
    hubs,
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
