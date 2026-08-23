"use client";

import { useRouter } from "next/navigation";
import { preload } from "react-dom";
import {
  getBackdropImagePath,
  getPosterImagePath,
  type ItemMetadata,
} from "@multiplex/plex-query";

import { getPlexImagePath } from "~/lib/plex-image";
import { getItemDetailsHref } from "~/lib/plex-routes";
import {
  getActiveSyncEngineCollections,
  getSyncEngineTrpcClient,
  hasFreshMediaItemDetails,
  mediaItemRowKey,
  resolveItemCredentials,
  warmMediaItem,
} from "~/lib/sync-engine";

export interface ItemDetailsNavigationTarget {
  serverId: string;
  type: string;
  ratingKey: string;
}

function getHref(target: ItemDetailsNavigationTarget) {
  return getItemDetailsHref(target.serverId, target.type, target.ratingKey);
}

function preloadDetailsImages(
  item: ItemMetadata,
  credentials: { serverUrl?: string; authToken?: string },
) {
  const urls = [
    getPlexImagePath(getBackdropImagePath(item), {
      width: 1280,
      height: 720,
      serverUrl: credentials.serverUrl,
      authToken: credentials.authToken,
    }),
    getPlexImagePath(getPosterImagePath(item), {
      width: 440,
      height: 660,
      serverUrl: credentials.serverUrl,
      authToken: credentials.authToken,
    }),
  ];
  for (const src of urls) {
    if (!src) continue;
    preload(src, { as: "image", fetchPriority: "low" });
  }
}

export function useItemDetailsNavigation() {
  const router = useRouter();

  const prefetch = (target: ItemDetailsNavigationTarget) => {
    const href = getHref(target);
    // Warm both the RSC runtime prerender and the sync-engine details payload.
    void router.prefetch(href);
    const collections = getActiveSyncEngineCollections();
    if (!collections) return;
    const key = mediaItemRowKey(target.serverId, target.ratingKey);
    const existing = collections.mediaItems.get(key);
    const existingCredentials = resolveItemCredentials(key, existing);
    if (
      hasFreshMediaItemDetails(existing) &&
      existing?.item &&
      existingCredentials.authToken
    ) {
      preloadDetailsImages(existing.item, existingCredentials);
      return;
    }

    void warmMediaItem(collections, getSyncEngineTrpcClient(), {
      serverId: target.serverId,
      ratingKey: target.ratingKey,
    })
      .then((row) => {
        if (row?.item) {
          preloadDetailsImages(row.item, {
            serverUrl: row.serverUrl ?? undefined,
            authToken: row.authToken ?? undefined,
          });
        }
      })
      .catch(() => undefined);
  };

  const navigate = (target: ItemDetailsNavigationTarget) => {
    prefetch(target);
    router.push(getHref(target));
  };

  return { getHref, prefetch, navigate };
}
