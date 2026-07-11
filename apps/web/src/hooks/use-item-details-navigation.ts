"use client";

import { useRouter } from "next/navigation";

import { PLEX_DETAILS_QUERY_OPTIONS } from "~/lib/plex-details-query-options";
import { getItemDetailsHref } from "~/lib/plex-routes";
import { api } from "~/trpc/react";

export interface ItemDetailsNavigationTarget {
  serverId: string;
  type: string;
  ratingKey: string;
}

export function useItemDetailsNavigation() {
  const router = useRouter();
  const utils = api.useUtils();

  const getHref = (target: ItemDetailsNavigationTarget) =>
    getItemDetailsHref(target.serverId, target.type, target.ratingKey);

  const prefetch = (target: ItemDetailsNavigationTarget) => {
    void utils.plex.getItemDetails.prefetch(
      {
        serverId: target.serverId,
        ratingKey: target.ratingKey,
      },
      PLEX_DETAILS_QUERY_OPTIONS,
    );
  };

  const navigate = (target: ItemDetailsNavigationTarget) => {
    prefetch(target);
    router.push(getHref(target));
  };

  return { getHref, prefetch, navigate };
}
