import { notFound } from "next/navigation";

import { AppPageLayout } from "~/components/app-page-layout";
import { PlaylistManagement } from "~/components/playlist/playlist-management";
import { api, HydrateClient } from "~/trpc/server";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    playlistRatingKey: string;
  }>;
  searchParams: Promise<{ sectionId?: string }>;
}

export default async function PlaylistPage({
  params,
  searchParams,
}: PageProps) {
  const { machineIdentifier, playlistRatingKey } = await params;
  const { sectionId: rawSectionId } = await searchParams;

  if (!/^[1-9]\d*$/.test(playlistRatingKey)) {
    notFound();
  }

  const librarySectionId =
    rawSectionId && /^[1-9]\d*$/.test(rawSectionId) ? rawSectionId : undefined;
  const input = { serverId: machineIdentifier, playlistRatingKey };

  await Promise.all([
    api.plex.getPlaylist.prefetch(input),
    api.plex.getPlaylistContents.prefetch({
      ...input,
      start: 0,
      size: 50,
    }),
  ]);

  return (
    <AppPageLayout title="Playlist">
      <HydrateClient>
        <PlaylistManagement
          serverId={machineIdentifier}
          playlistRatingKey={playlistRatingKey}
          librarySectionId={librarySectionId}
        />
      </HydrateClient>
    </AppPageLayout>
  );
}
