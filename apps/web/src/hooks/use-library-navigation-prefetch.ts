"use client";

import { useRouter } from "next/navigation";

import { api } from "~/trpc/api";

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
      void utils.plex.getLibraryHubs.prefetch({
        machineIdentifier,
        sectionId: source,
      });
    } catch {
      // Ignore malformed hrefs from sidebar data.
    }
  };

  return { prefetchLibrary };
}
