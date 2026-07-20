"use client";

import { useRouter } from "next/navigation";
import { preload } from "react-dom";
import { getBackdropImagePath, getPosterImagePath, type ItemMetadata } from "@multiplex/plex-query";

import { PLEX_DETAILS_QUERY_OPTIONS } from "~/lib/plex-details-query-options";
import { getPlexImagePath } from "~/lib/plex-image";
import { getItemDetailsHref } from "~/lib/plex-routes";
import { api } from "~/trpc/api";

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
  const utils = api.useUtils();

  const prefetch = (target: ItemDetailsNavigationTarget) => {
    const href = getHref(target);
    // Warm both the RSC runtime prerender and the TanStack details payload.
    void router.prefetch(href);
    void utils.plex.getItemDetails
      .prefetch(
        {
          serverId: target.serverId,
          ratingKey: target.ratingKey,
        },
        PLEX_DETAILS_QUERY_OPTIONS,
      )
      .then(() => {
        const details = utils.plex.getItemDetails.getData({
          serverId: target.serverId,
          ratingKey: target.ratingKey,
        });
        if (details?.item) {
          preloadDetailsImages(target.serverId, details.item);
        }
      });
  };

  const navigate = (target: ItemDetailsNavigationTarget) => {
    prefetch(target);
    router.push(getHref(target));
  };

  return { getHref, prefetch, navigate };
}
