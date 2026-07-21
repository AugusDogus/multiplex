"use client";

import { useRouter } from "next/navigation";
import { preload } from "react-dom";

import { getPosterImagePath, type HubWithServer } from "@multiplex/plex-query";
import { getPlexImagePath } from "~/lib/plex-image";
import {
  getActiveSyncEngineCollections,
  getSyncEngineTrpcClient,
  toHubWithServer,
  warmLibraryHubs,
} from "~/lib/sync-engine";
import { api } from "~/trpc/api";

const PREFETCH_POSTER_COUNT = 8;

function preloadPosterImages(hubs: HubWithServer[]) {
  const urls: string[] = [];
  for (const hub of hubs) {
    for (const item of hub.items) {
      // Match MediaPosterCard dimensions so the browser HTTP cache hits on paint.
      const src = getPlexImagePath(item.serverId, getPosterImagePath(item), {
        width: 200,
        height: 300,
      });
      if (src) urls.push(src);
      if (urls.length >= PREFETCH_POSTER_COUNT) break;
    }
    if (urls.length >= PREFETCH_POSTER_COUNT) break;
  }
  for (const src of urls) {
    preload(src, { as: "image", fetchPriority: "low" });
  }
}

/**
 * Prefetch library chrome + Recommended hubs on sidebar hover so the soft-nav
 * click does not wait on a cold PMS round-trip.
 */
export function useLibraryNavigationPrefetch() {
  const router = useRouter();
  const utils = api.useUtils();

  const prefetchLibrary = (href: string) => {
    try {
      const url = new URL(href, "http://local.invalid");
      const parts = url.pathname.split("/").filter(Boolean);
      // /media/[machineIdentifier]/[providerIdentifier]?source=...
      if (parts[0] !== "media" || !parts[1]) return;
      const machineIdentifier = parts[1];
      const source = url.searchParams.get("source");
      if (!source) return;

      void router.prefetch(href);
      void utils.plex.getLibraryPivots.prefetch({
        machineIdentifier,
        sectionId: source,
      });
      const collections = getActiveSyncEngineCollections();
      if (!collections) return;
      void warmLibraryHubs(collections, getSyncEngineTrpcClient(), {
        machineIdentifier,
        sectionId: source,
      }).then((snapshot) => {
        preloadPosterImages(snapshot.hubs.map(toHubWithServer));
      });
    } catch {
      // Ignore malformed hrefs from sidebar data.
    }
  };

  return { prefetchLibrary };
}
