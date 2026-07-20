import { Suspense } from "react";
import { parseLibraryItemUri } from "@multiplex/plex-query";

import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { ContinueWatching } from "~/components/continue-watching";
import { HomeHubs } from "~/components/home-hubs";
import { ContinueWatchingSkeleton } from "~/components/media-carousel-skeleton";
import { MediaHubRowSkeleton } from "~/components/media-hub-row";
import { WatchTogetherRow } from "~/components/watch-together/watch-together-row";
import { enableHomeLoadDiag, getHomeDiagSpans, withHomeDiagSpan } from "~/server/home-load-diag";
import { api, HydrateClient } from "~/trpc/server";

// Prefetch home rows with the session so soft-nav back to `/` is instant.
export const prefetch = "allow-runtime";

/**
 * Stream each home section independently so Continue Watching is not blocked
 * on hubs / Watch Together (or the slowest of the three). Official Plex paints
 * a shell quickly and fills rows as data arrives — match that shape.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ diag?: string }> }) {
  const params = await searchParams;
  const diag = params.diag === "1";
  if (diag) {
    enableHomeLoadDiag();
  }

  return (
    <>
      <AppHeader />
      <AppPageContent spacing="home">
        <Suspense fallback={null}>
          <PrefetchedWatchTogetherRow />
        </Suspense>
        <Suspense fallback={<ContinueWatchingSkeleton />}>
          <PrefetchedContinueWatching />
        </Suspense>
        <Suspense
          fallback={
            <>
              <MediaHubRowSkeleton />
              <MediaHubRowSkeleton />
            </>
          }
        >
          <PrefetchedHomeHubs />
        </Suspense>
        {diag ? (
          <Suspense fallback={null}>
            <HomeDiagBeacon />
          </Suspense>
        ) : null}
      </AppPageContent>
    </>
  );
}

async function PrefetchedContinueWatching() {
  await api.plex.getAllContinueWatching.prefetch();
  return (
    <HydrateClient>
      <ContinueWatching />
    </HydrateClient>
  );
}

async function PrefetchedHomeHubs() {
  await api.plex.getHomeHubs.prefetch();
  return (
    <HydrateClient>
      <HomeHubs />
    </HydrateClient>
  );
}

async function PrefetchedWatchTogetherRow() {
  await api.plex.getWatchTogetherRooms.prefetch();
  const rooms = await api.plex.getWatchTogetherRooms();
  // Collapse the client N+1: each card used to call getItemDetails on mount.
  await Promise.all(
    rooms.map((room) => {
      const source = parseLibraryItemUri(room.sourceUri);
      if (!source) return Promise.resolve();
      return api.plex.getItemDetails.prefetch({
        serverId: source.serverId,
        ratingKey: source.ratingKey,
      });
    }),
  );
  return (
    <HydrateClient>
      <WatchTogetherRow />
    </HydrateClient>
  );
}

/** Temporary: measure home prefetch lanes when `?diag=1`. */
async function HomeDiagBeacon() {
  await Promise.all([
    withHomeDiagSpan("prefetch.getAllContinueWatching", () =>
      api.plex.getAllContinueWatching.prefetch(),
    ),
    withHomeDiagSpan("prefetch.getHomeHubs", () => api.plex.getHomeHubs.prefetch()),
    withHomeDiagSpan("prefetch.getWatchTogetherRooms", () =>
      api.plex.getWatchTogetherRooms.prefetch(),
    ),
  ]);

  const spans = getHomeDiagSpans();
  return (
    <script
      id="home-load-diag"
      type="application/json"
      // Evidence-only payload for the hang investigation probe.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(spans) }}
    />
  );
}
