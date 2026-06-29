import { Suspense } from "react";

import { AppHeader } from "~/components/app-header";
import { AppPageContent } from "~/components/app-page-content";
import { WatchTogetherLobby } from "~/components/watch-together/watch-together-lobby";
import { api, HydrateClient } from "~/trpc/server";

interface PageProps {
  params: Promise<{
    roomId: string;
  }>;
}

export default function WatchTogetherPage({ params }: PageProps) {
  return (
    <>
      <AppHeader>Watch Together</AppHeader>
      <AppPageContent>
        <Suspense
          fallback={
            <p className="text-muted-foreground text-sm">
              Loading Watch Together room...
            </p>
          }
        >
          <WatchTogetherRoom params={params} />
        </Suspense>
      </AppPageContent>
    </>
  );
}

async function WatchTogetherRoom({ params }: PageProps) {
  const { roomId } = await params;

  await api.plex.getWatchTogetherRoom.prefetch({ roomId });

  return (
    <HydrateClient>
      <WatchTogetherLobby roomId={roomId} />
    </HydrateClient>
  );
}
