import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { ContinueWatching } from "~/components/continue-watching";
import { HomeHubs } from "~/components/home-hubs";
import { WatchTogetherRow } from "~/components/watch-together/watch-together-row";

/**
 * Soft-nav must not await Plex RSC prefetches. Watch Together, Continue
 * Watching, and home hubs all paint from the TanStack DB sync-engine
 * replica (OPFS) and can fill after first paint. App shells come from
 * partialPrefetching; runtime URL data from Link prefetch={true}.
 */

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
