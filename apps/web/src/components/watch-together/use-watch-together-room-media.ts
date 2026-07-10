"use client";

import {
  getBackdropImagePath,
  getPlexImageUrl,
  getPosterImagePath,
  parseLibraryItemUri,
} from "@multiplex/plex-query";
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Option from "effect/Option";

import { isAsyncResultLoading } from "~/lib/effect/async-result";
import type { ItemDetails } from "~/lib/effect/plex-boundary";
import { itemDetailsAtom } from "~/lib/effect/plex-atoms";

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
  const queryEnabled = enabled && Boolean(source);

  const detailsResult = useAtomValue(
    itemDetailsAtom({
      serverId: source?.serverId ?? "",
      ratingKey: source?.ratingKey ?? "",
      enabled: queryEnabled,
    }),
  );

  const details =
    Option.getOrUndefined(AsyncResult.value(detailsResult)) ?? undefined;
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
    details: details ?? undefined,
    item,
    posterUrl,
    backdropUrl,
    isPending: queryEnabled && isAsyncResultLoading(detailsResult),
    isError: queryEnabled && AsyncResult.isFailure(detailsResult),
  };
}
