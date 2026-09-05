import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { ContinueWatching } from "~/components/continue-watching";
import { HomeHubs } from "~/components/home-hubs";
import { WatchTogetherRow } from "~/components/watch-together/watch-together-row";

/**
 * Soft-nav must not await Plex RSC prefetches. Watch Together, Continue
 * Watching, and home hubs all paint from the TanStack DB sync-engine
 * replica (OPFS) and can fill after first paint. The shell itself comes from
 * partialPrefetching; this route has no URL data to prefetch per link.
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
