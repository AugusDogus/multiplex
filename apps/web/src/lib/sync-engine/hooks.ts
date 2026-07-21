"use client";

import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
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
  const { data = [], isLoading } = useLiveQuery(
    (q) =>
      q.from({
        servers: collections?.servers ?? emptyServersCollection,
      }),
    [collections],
  );

  return {
    data: collections ? (data as unknown as SanitizedServerRow[]) : [],
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
  const { data = [], isLoading } = useLiveQuery(
    (q) =>
      q.from({
        items: collections?.continueWatching ?? emptyContinueWatchingCollection,
      }),
    [collections],
  );

  return {
    data: collections
      ? (data as unknown as SanitizedContinueWatchingRow[])
      : [],
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
  const { data = [], isLoading } = useLiveQuery(
    (q) =>
      q.from({
        hubs: collections?.homeHubs ?? emptyHomeHubsCollection,
      }),
    [collections],
  );

  return {
    data: collections ? (data as unknown as SanitizedHomeHubRow[]) : [],
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
  const { data = [], isLoading } = useLiveQuery(
    (q) =>
      q.from({
        libraries:
          collections?.serverLibraries ?? emptyServerLibrariesCollection,
      }),
    [collections],
  );

  return {
    data: collections ? (data as unknown as SanitizedServerLibraryRow[]) : [],
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
  const { data = [], isLoading } = useLiveQuery(
    (q) =>
      q.from({
        items: collections?.mediaItems ?? emptyMediaItemsCollection,
      }),
    [collections],
  );

  return {
    data: collections ? (data as unknown as SanitizedMediaItemRow[]) : [],
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
  const { data = [], isLoading } = useLiveQuery(
    (q) =>
      q.from({
        rooms:
          collections?.watchTogetherRooms ?? emptyWatchTogetherRoomsCollection,
      }),
    [collections],
  );

  const rows = collections
    ? (data as unknown as SanitizedWatchTogetherRoomRow[])
    : [];

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
  const { data, isLoading } = useLiveQuery(
    (q) => {
      if (!roomId) return undefined;
      return q
        .from({
          rooms:
            collections?.watchTogetherRooms ??
            emptyWatchTogetherRoomsCollection,
        })
        .where(({ rooms }) => eq(rooms.id, roomId))
        .findOne();
    },
    [collections, roomId],
  );

  const row = data as unknown as SanitizedWatchTogetherRoomRow | undefined;
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
  const { data, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({
          user: collections?.userInfo ?? emptyUserInfoCollection,
        })
        .where(({ user }) => eq(user.id, USER_INFO_ROW_ID))
        .findOne(),
    [collections],
  );

  const row = data as unknown as SanitizedUserInfoRow | undefined;

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
  const { data, isLoading } = useLiveQuery(
    (q) => {
      if (!enabled) return undefined;
      return q
        .from({
          items: collections?.mediaItems ?? emptyMediaItemsCollection,
        })
        .where(({ items }) => eq(items.id, id))
        .findOne();
    },
    [collections, enabled, id],
  );

  const row = data as unknown as SanitizedMediaItemRow | undefined;
  const hasFullDetails = Boolean(row?.hasFullDetails && row.item);
  const needsWarm = Boolean(enabled && collections && !hasFullDetails);
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
        (!collections || (!hasFullDetails && (isLoading || isWarming))),
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
  const { data } = useLiveQuery(
    (q) => {
      if (!enabled) return undefined;
      return q
        .from({
          items: collections?.mediaItems ?? emptyMediaItemsCollection,
        })
        .where(({ items }) => eq(items.id, id))
        .findOne();
    },
    [collections, enabled, id],
  );

  const row = data as unknown as SanitizedMediaItemRow | undefined;
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
  const { data, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({
          snapshots: collections?.libraryHubs ?? emptyLibraryHubsCollection,
        })
        .where(({ snapshots }) => eq(snapshots.id, id))
        .findOne(),
    [collections, id],
  );

  const snapshot = data as unknown as
    | SanitizedLibraryHubsSnapshotRow
    | undefined;
  const needsWarm = Boolean(collections && !snapshot);
  const { isWarming } = useWarmOnce(
    needsWarm ? `library-hubs:${id}` : null,
    async () => {
      if (!collections) return;
      await warmLibraryHubs(collections, getSyncEngineTrpcClient(), {
        machineIdentifier,
        sectionId,
      });
    },
    needsWarm,
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
  const { data = [], isLoading } = useLiveQuery(
    (q) =>
      q.from({
        invitees:
          collections?.watchTogetherInvitees ??
          emptyWatchTogetherInviteesCollection,
      }),
    [collections],
  );

  const rows = collections
    ? (data as unknown as SanitizedWatchTogetherInviteeRow[])
    : [];
  const needsWarm = Boolean(enabled && collections && rows.length === 0);
  const { isWarming, error } = useWarmOnce(
    needsWarm ? "invitees" : null,
    async () => {
      if (!collections) return;
      await warmWatchTogetherInvitees(collections, getSyncEngineTrpcClient());
    },
    needsWarm,
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
  const { data } = useLiveQuery(
    (q) => {
      if (!enabled) return undefined;
      return q
        .from({
          results: collections?.searchResults ?? emptySearchResultsCollection,
        })
        .where(({ results }) => eq(results.id, id))
        .findOne();
    },
    [collections, enabled, id],
  );

  const row = data as unknown as SanitizedSearchResultsRow | undefined;
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
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({
          playlists: collections?.playlists ?? emptyPlaylistsCollection,
        })
        .where(({ playlists }) => eq(playlists.id, id))
        .findOne(),
    [collections, id],
  );

  const row = data as unknown as SanitizedPlaylistRow | undefined;
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
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({
          contents:
            collections?.playlistContents ?? emptyPlaylistContentsCollection,
        })
        .where(({ contents }) => eq(contents.id, id))
        .findOne(),
    [collections, id],
  );

  const row = data as unknown as SanitizedPlaylistContentsRow | undefined;
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
  const { data } = useLiveQuery(
    (q) => {
      if (!enabled) return undefined;
      return q
        .from({
          playlists: collections?.itemPlaylists ?? emptyItemPlaylistsCollection,
        })
        .where(({ playlists }) => eq(playlists.id, id))
        .findOne();
    },
    [collections, enabled, id],
  );

  const row = data as unknown as SanitizedItemPlaylistsRow | undefined;
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
  const { data } = useLiveQuery(
    (q) => {
      if (!enabled) return undefined;
      return q
        .from({
          values:
            collections?.libraryFilterValues ??
            emptyLibraryFilterValuesCollection,
        })
        .where(({ values }) => eq(values.id, id))
        .findOne();
    },
    [collections, enabled, id],
  );

  const row = data as unknown as SanitizedLibraryFilterValuesRow | undefined;
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
  const { data } = useLiveQuery(
    (q) => {
      if (!enabled) return undefined;
      return q
        .from({
          queues: collections?.playQueues ?? emptyPlayQueuesCollection,
        })
        .where(({ queues }) => eq(queues.id, id))
        .findOne();
    },
    [collections, enabled, id],
  );

  const row = data as unknown as SanitizedPlayQueueRow | undefined;

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
