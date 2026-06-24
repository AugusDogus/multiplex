import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { WatchTogetherLobby } from "~/components/watch-together/watch-together-lobby";
import { api, HydrateClient } from "~/trpc/server";

interface PageProps {
  params: Promise<{
    roomId: string;
  }>;
}

export default async function WatchTogetherPage({ params }: PageProps) {
  const { roomId } = await params;

  void api.plex.getWatchTogetherRoom.prefetch({ roomId });

  return (
    <HydrateClient>
      <AppHeader>Watch Together</AppHeader>
      <AppPageContent>
        <WatchTogetherLobby roomId={roomId} />
      </AppPageContent>
    </HydrateClient>
  );
}
