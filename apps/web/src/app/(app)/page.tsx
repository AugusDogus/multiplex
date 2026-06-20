import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { ContinueWatching } from "~/components/continue-watching";
import { HomeHubs } from "~/components/home-hubs";
import { api } from "~/trpc/server";

export default async function Page() {
  await Promise.all([
    api.plex.getAllContinueWatching.prefetch(),
    api.plex.getHomeHubs.prefetch(),
  ]);

  return (
    <>
      <AppHeader />
      <AppPageContent spacing="home">
        <ContinueWatching />
        <HomeHubs />
      </AppPageContent>
    </>
  );
}
