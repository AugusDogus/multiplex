import { Suspense } from "react";
import { parseLibraryItemUri } from "@multiplex/plex-query";

import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { ContinueWatching } from "~/components/continue-watching";
import { HomeHubs } from "~/components/home-hubs";
import { ContinueWatchingSkeleton } from "~/components/media-carousel-skeleton";
import { MediaHubRowSkeleton } from "~/components/media-hub-row";
import { WatchTogetherRow } from "~/components/watch-together/watch-together-row";
import { api, HydrateClient } from "~/trpc/server";

// Prefetch home rows with the session so soft-nav back to `/` is instant.
export const prefetch = "allow-runtime";

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
  // Soft-fail so a section error mounts the client row (localized retry/empty)
  // instead of bubbling past Suspense to the page error boundary.
  await api.plex.getAllContinueWatching.prefetch().catch(() => undefined);
  return (
    <HydrateClient>
      <ContinueWatching />
    </HydrateClient>
  );
}

async function PrefetchedHomeHubs() {
  await api.plex.getHomeHubs.prefetch().catch(() => undefined);
  return (
    <HydrateClient>
      <HomeHubs />
    </HydrateClient>
  );
}

async function PrefetchedWatchTogetherRow() {
  await api.plex.getWatchTogetherRooms.prefetch().catch(() => undefined);
  const rooms = await api.plex.getWatchTogetherRooms().catch(() => []);
  // Collapse the client N+1: each card used to call getItemDetails on mount.
  // allSettled so one bad room cannot block the rest of the row.
  await Promise.allSettled(
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
