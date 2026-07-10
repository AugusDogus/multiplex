import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { ContinueWatching } from "~/components/continue-watching";
import { HomeHubs } from "~/components/home-hubs";
import { WatchTogetherRow } from "~/components/watch-together/watch-together-row";

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
