"use client";

import {
  getBackdropImagePath,
  getPosterImagePath,
  parseLibraryItemUri,
} from "@multiplex/plex-query";

import { useSyncedItemDetails } from "~/lib/sync-engine";
import { getPlexImagePath } from "~/lib/plex-image";
import type { RouterOutputs } from "~/trpc/api";

type ItemDetails = NonNullable<RouterOutputs["plex"]["getItemDetails"]>;

interface UseWatchTogetherRoomMediaOptions {
  enabled?: boolean;
}

interface WatchTogetherRoomMedia {
  source: ReturnType<typeof parseLibraryItemUri>;
  details: ItemDetails | undefined;
  item: ItemDetails["item"] | undefined;
  posterUrl: string | undefined;
  backdropUrl: string | undefined;
  isPending: boolean;
  isError: boolean;
}

/**
 * Resolves the media behind a Watch Together room (which only carries a
 * `sourceUri`) into the poster/backdrop art and full metadata used across the
 * home row and lobby. Reads/warms the sync-engine `mediaItems` collection so
 * the home row card and lobby share one durable cache.
 */
export function useWatchTogetherRoomMedia(
  sourceUri: string | undefined,
  { enabled = true }: UseWatchTogetherRoomMediaOptions = {},
): WatchTogetherRoomMedia {
  const source = sourceUri ? parseLibraryItemUri(sourceUri) : null;

  const detailsQuery = useSyncedItemDetails(
    source?.serverId ?? "",
    source?.ratingKey ?? "",
    { enabled: enabled && Boolean(source) },
  );

  const details = detailsQuery.details;
  const item = details?.item;
  const posterUrl = item
    ? getPlexImagePath(source?.serverId, getPosterImagePath(item), {
        width: 320,
        height: 480,
      })
    : undefined;
  const backdropUrl = item
    ? getPlexImagePath(source?.serverId, getBackdropImagePath(item), {
        width: 1280,
        height: 720,
      })
    : undefined;

  return {
    source,
    details,
    item,
    posterUrl,
    backdropUrl,
    isPending: Boolean(source) && detailsQuery.isPending,
    isError: Boolean(source) && detailsQuery.isError,
  };
}
