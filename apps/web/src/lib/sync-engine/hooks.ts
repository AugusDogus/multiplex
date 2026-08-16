"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { PlexUserInfo } from "@multiplex/plex-query";

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
  emptyUserInfoCollection,
  emptyWatchTogetherInviteesCollection,
  emptyWatchTogetherRoomsCollection,
} from "./empty-collections";
import { sortContinueWatchingRows } from "./continue-watching-view";
import { toHubWithServer } from "./home-hubs-view";
import { toItemDetails, toItemMetadata } from "./item-details-view";
import { resolveItemCredentials } from "./resolve-connection";
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
  SanitizedUserInfoRow,
  SanitizedWatchTogetherInviteeRow,
  SanitizedWatchTogetherRoomRow,
} from "./sanitize";
import { getSyncEngineTrpcClient } from "./trpc-client";
import { toPlexUserInfo } from "./user-info-view";
import { toWatchTogetherRoom } from "./watch-together-view";

const WARM_MAX_ATTEMPTS = 2;
const WARM_ATTEMPT_TIMEOUT_MS = 5_000;

function runWarmAttempt(warm: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(
        new Error(
          `Sync data request did not finish within ${WARM_ATTEMPT_TIMEOUT_MS}ms. Check the connection and retry.`,
        ),
      );
    }, WARM_ATTEMPT_TIMEOUT_MS);
    void warm().then(
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      (cause: unknown) => {
        window.clearTimeout(timeout);
        reject(new Error("Sync data request failed.", { cause }));
      },
    );
  });
}

function useWarmOnce(
  key: string | null,
  warm: () => Promise<void>,
  enabled: boolean,
) {
  const [isWarming, setIsWarming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const warmEvent = useEffectEvent(warm);
  // Track successful/in-flight key so empty results / 404s do not spin forever.
  // Failures clear this and bump `retryNonce` (capped) so credential refill can retry.
  const settledKeyRef = useRef<string | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  const attemptCountRef = useRef(0);
  const retry = () => {
    attemptCountRef.current = 0;
    settledKeyRef.current = null;
    setRetryNonce((value) => value + 1);
  };

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
    void runWarmAttempt(warmEvent)
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
      // React Strict Mode replays effects. Do not let the canceled first setup
      // leave its key marked as settled and suppress the real warm attempt.
      if (settledKeyRef.current === key) settledKeyRef.current = null;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [enabled, key, retryNonce]);

  return { isWarming, error, retry };
}

export function useSyncedContinueWatching() {
  const collections = useSyncEngineCollections();
  const { data, isLoading } = useCollectionRows<SanitizedContinueWatchingRow>(
    collections?.continueWatching ?? emptyContinueWatchingCollection,
  );

  return {
    data: collections ? sortContinueWatchingRows(data) : [],
    isLoading: !collections || isLoading,
    isReady: Boolean(collections),
  };
}

export function useSyncedHomeHubs() {
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

export function useSyncedServerLibraries() {
  const collections = useSyncEngineCollections();
  const { data, isLoading } = useCollectionRows<SanitizedServerLibraryRow>(
    collections?.serverLibraries ?? emptyServerLibrariesCollection,
  );
  // Observe the Query Collection's underlying query without double-fetching.
  const { error: queryError } = useQuery({
    queryKey: ["sync-engine", "plex", "getAllServerLibraries"],
    queryFn: (): Promise<SanitizedServerLibraryRow[]> => Promise.resolve([]),
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

export function useSyncedWatchTogetherRooms() {
  const collections = useSyncEngineCollections();
  const { data, isLoading } = useCollectionRows<SanitizedWatchTogetherRoomRow>(
    collections?.watchTogetherRooms ?? emptyWatchTogetherRoomsCollection,
  );

  const rows = collections ? data : [];
  const rooms = rows.map(toWatchTogetherRoom);

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
) {
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

  const room = row ? toWatchTogetherRoom(row) : undefined;

  return {
    room,
    isPending: Boolean(
      enabled && roomId && (!collections || (!row && (isLoading || isWarming))),
    ),
    isError: Boolean(error && !row),
  };
}

export function useSyncedUserInfo(options?: { initialData?: PlexUserInfo }) {
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

  const data = row ? toPlexUserInfo(row) : options?.initialData;

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
) {
  const enabled = (options?.enabled ?? true) && Boolean(serverId && ratingKey);
  const collections = useSyncEngineCollections();
  const id = mediaItemRowKey(serverId, ratingKey);
  const { data: row, isLoading } = useCollectionRowById<SanitizedMediaItemRow>(
    collections?.mediaItems ?? emptyMediaItemsCollection,
    enabled ? id : null,
  );

  const hasFullDetails = Boolean(row?.hasFullDetails && row.item);
  const missingPlayCredentials = !resolveItemCredentials(id, row ?? undefined)
    .authToken;
  // Re-warm when OPFS has details but credentials are still missing.
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

  const details =
    hasFullDetails && row ? (toItemDetails(row) ?? undefined) : undefined;

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
) {
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

  const data = row ? toItemMetadata(row) : null;

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
) {
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

  const hubs = snapshot ? snapshot.hubs.map(toHubWithServer) : [];

  return {
    hubs,
    isPending: !collections || (!snapshot && (isLoading || isWarming)),
    isFetching: isWarming,
  };
}

export function useSyncedWatchTogetherInvitees(options?: {
  enabled?: boolean;
}) {
  const enabled = options?.enabled ?? true;
  const collections = useSyncEngineCollections();
  const { data, isLoading } =
    useCollectionRows<SanitizedWatchTogetherInviteeRow>(
      collections?.watchTogetherInvitees ??
        emptyWatchTogetherInviteesCollection,
    );

  const rows = collections ? data : [];
  const { isWarming, error, retry } = useWarmOnce(
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
    retry,
  };
}

export function useSyncedSearchResults(query: string) {
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
    data: row?.payload,
    isLoading: Boolean(enabled && (!collections || (!row && isWarming))),
    error,
  };
}

export function useSyncedPlaylist(serverId: string, playlistRatingKey: string) {
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
    data: row?.payload,
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
}) {
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
    data: row?.payload,
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
) {
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
    data: row?.payload,
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
) {
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
    data: row?.values,
    isLoading: Boolean(enabled && (!collections || (!row && isWarming))),
  };
}

export function useSyncedPlayQueue(
  serverId: string,
  playQueueId: string,
  options?: { enabled?: boolean; refetchIntervalMs?: number },
) {
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
    data: row?.payload,
  };
}
