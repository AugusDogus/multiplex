import { Suspense } from "react";

import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { ContinueWatching } from "~/components/continue-watching";
import { HomeHubs } from "~/components/home-hubs";
import { ContinueWatchingSkeleton } from "~/components/media-carousel-skeleton";
import { MediaHubRowSkeleton } from "~/components/media-hub-row";
import { WatchTogetherRow } from "~/components/watch-together/watch-together-row";
import { api, HydrateClient } from "~/trpc/server";

/**
 * Stream each home section independently so Continue Watching is not blocked
 * on hubs / Watch Together (or the slowest of the three). Official Plex paints
 * a shell quickly and fills rows as data arrives — match that shape.
 */
export default function Page() {
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
  return (
    <HydrateClient>
      <WatchTogetherRow />
    </HydrateClient>
  );
}
