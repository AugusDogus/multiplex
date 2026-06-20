import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { ContinueWatching } from "~/components/continue-watching";
import { HomeHubs } from "~/components/home-hubs";
import { api, HydrateClient } from "~/trpc/server";

export default async function Page() {
  // Prefetch into the per-request QueryClient so HydrateClient can dehydrate
  // the cache to client useQuery hooks. Direct api.*() calls do not populate
  // the cache — see https://trpc.io/docs/client/react/server-components
  // Prefetch sequentially to avoid cold-start connection storms against PMS.
  await api.plex.getHomeHubs.prefetch();
  await api.plex.getAllContinueWatching.prefetch();

  return (
    <HydrateClient>
      <AppHeader />
      <AppPageContent spacing="home">
        <ContinueWatching />
        <HomeHubs />
      </AppPageContent>
    </HydrateClient>
  );
}
