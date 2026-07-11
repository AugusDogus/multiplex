"use client";

import {
  getBackdropImagePath,
  getPlexImageUrl,
  getPosterImagePath,
  parseLibraryItemUri,
} from "@multiplex/plex-query";

import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";

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
 * home row and lobby. The underlying `getItemDetails` query is cached per
 * server+item, so the home row card and lobby share the same fetch (navigating
 * into the lobby is instant). The row only needs the poster, so it over-fetches
 * `playTarget`/`serverName` here; that is accepted in exchange for the shared
 * cache. Rooms are created from a play target (movie/episode), so the heavier
 * show/season children fetch inside `getItemDetails` is not triggered.
 */
export function useWatchTogetherRoomMedia(
  sourceUri: string | undefined,
  { enabled = true }: UseWatchTogetherRoomMediaOptions = {},
): WatchTogetherRoomMedia {
  const source = sourceUri ? parseLibraryItemUri(sourceUri) : null;

  const detailsQuery = api.plex.getItemDetails.useQuery(
    {
      serverId: source?.serverId ?? "",
      ratingKey: source?.ratingKey ?? "",
    },
    {
      enabled: enabled && Boolean(source),
      staleTime: 60_000,
    },
  );

  const details = detailsQuery.data ?? undefined;
  const item = details?.item;
  const serverUrl = details?.serverUrl ?? undefined;
  const authToken = details?.authToken ?? undefined;
  const posterUrl = item
    ? getPlexImageUrl(getPosterImagePath(item), serverUrl, authToken, {
        width: 320,
        height: 480,
      })
    : undefined;
  const backdropUrl = item
    ? getPlexImageUrl(getBackdropImagePath(item), serverUrl, authToken, {
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
