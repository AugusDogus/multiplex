import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { ContinueWatching } from "~/components/continue-watching";
import { HomeHubs } from "~/components/home-hubs";
import { api } from "~/trpc/server";

export default async function Page() {
  const [continueWatchingItems, homeHubs] = await Promise.all([
    api.plex.getAllContinueWatching(),
    api.plex.getHomeHubs(),
  ] as const);

  return (
    <>
      <AppHeader />
      <AppPageContent spacing="home">
        <ContinueWatching items={continueWatchingItems} />
        <HomeHubs hubs={homeHubs} />
      </AppPageContent>
    </>
  );
}
