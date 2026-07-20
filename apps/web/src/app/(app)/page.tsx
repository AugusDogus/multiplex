import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { ContinueWatching } from "~/components/continue-watching";
import { HomeHubs } from "~/components/home-hubs";
import { WatchTogetherRow } from "~/components/watch-together/watch-together-row";

/**
 * Soft-nav must not await Plex RSC prefeches. Continue Watching + home hubs
 * paint from the TanStack DB sync-engine replica (OPFS); Watch Together still
 * uses a client tRPC query and can fill after first paint.
 */
export const prefetch = "allow-runtime";

export default function Page() {
  return (
    <>
      <AppHeader />
      <AppPageContent spacing="home">
        <WatchTogetherRow />
        <ContinueWatching />
        <HomeHubs />
      </AppPageContent>
    </>
  );
}
