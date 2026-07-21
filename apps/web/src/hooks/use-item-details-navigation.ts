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

function preloadDetailsImages(serverId: string, item: ItemMetadata) {
  const urls = [
    getPlexImagePath(serverId, getBackdropImagePath(item), {
      width: 1280,
      height: 720,
    }),
    getPlexImagePath(serverId, getPosterImagePath(item), {
      width: 440,
      height: 660,
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
    void warmMediaItem(collections, getSyncEngineTrpcClient(), {
      serverId: target.serverId,
      ratingKey: target.ratingKey,
    })
      .then((row) => {
        if (row?.item && typeof row.item === "object") {
          preloadDetailsImages(target.serverId, row.item as ItemMetadata);
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
