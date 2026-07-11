import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { ContinueWatching } from "~/components/continue-watching";
import { HomeHubs } from "~/components/home-hubs";
import { WatchTogetherRow } from "~/components/watch-together/watch-together-row";
import { api, HydrateClient } from "~/trpc/server";

export default async function Page() {
  // Prefetch into the per-request QueryClient so HydrateClient can dehydrate
  // the cache to client useQuery hooks. Direct api.*() calls do not populate
  // the cache — see https://trpc.io/docs/client/react/server-components
  await Promise.allSettled([
    api.plex.getHomeHubs.prefetch(),
    api.plex.getAllContinueWatching.prefetch(),
    api.plex.getWatchTogetherRooms.prefetch(),
  ]);

  return (
    <HydrateClient>
      <AppHeader />
      <AppPageContent spacing="home">
        <WatchTogetherRow />
        <ContinueWatching />
        <HomeHubs />
      </AppPageContent>
    </HydrateClient>
  );
}
