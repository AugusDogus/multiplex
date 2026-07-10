"use client";

import { useContext } from "react";
import { useRouter } from "next/navigation";
import { RegistryContext } from "@effect/atom-react";

import { itemDetailsAtom } from "~/lib/effect/plex-atoms";
import { getItemDetailsHref } from "~/lib/plex-routes";

export interface ItemDetailsNavigationTarget {
  serverId: string;
  type: string;
  ratingKey: string;
}

export function useItemDetailsNavigation() {
  const router = useRouter();
  const registry = useContext(RegistryContext);

  const getHref = (target: ItemDetailsNavigationTarget) =>
    getItemDetailsHref(target.serverId, target.type, target.ratingKey);

  const prefetch = (target: ItemDetailsNavigationTarget) => {
    // Mount briefly so AtomHttpApi starts the fetch into the shared registry;
    // idle TTL keeps the result warm for the subsequent details navigation.
    const atom = itemDetailsAtom({
      serverId: target.serverId,
      ratingKey: target.ratingKey,
    });
    const unmount = registry.mount(atom);
    // Keep the subscription long enough for the request to settle / cache.
    window.setTimeout(unmount, 30_000);
  };

  const navigate = (target: ItemDetailsNavigationTarget) => {
    prefetch(target);
    router.push(getHref(target));
  };

  return { getHref, prefetch, navigate };
}
