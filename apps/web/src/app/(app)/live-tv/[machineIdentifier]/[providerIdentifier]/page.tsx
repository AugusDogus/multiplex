import { AppCenteredMessage } from "~/components/app-centered-message";
import { AppPageLayout } from "~/components/app-page-layout";
import { LibraryHeaderDropdown } from "~/components/library-header-dropdown";
import { LiveTvGuideRefresh } from "~/components/live-tv-guide-refresh";
import { TvGuide } from "~/components/tv-guide/tv-guide";
import { getAppPlexContext } from "~/server/queries/get-app-plex-context";
import { api } from "~/trpc/server";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    providerIdentifier: string;
  }>;
}

export default async function LiveTvPage({ params }: PageProps) {
  const { machineIdentifier, providerIdentifier: rawProviderIdentifier } =
    await params;

  const providerIdentifier = decodeURIComponent(rawProviderIdentifier);

  const startTime = (() => {
    const start = new Date();
    const minutes = start.getMinutes();
    const roundedMinutes = Math.floor(minutes / 15) * 15;
    start.setMinutes(roundedMinutes, 0, 0);
    return start;
  })();

  const endTime = (() => {
    const end = new Date(startTime);
    end.setHours(startTime.getHours() + 4);
    return end;
  })();

  const { servers, userInfo } = await getAppPlexContext();

  const targetServer = servers.find(
    (server) => server.clientIdentifier === machineIdentifier,
  );

  if (!targetServer) {
    return (
      <AppCenteredMessage
        title="Server Not Found"
        description="The requested Plex server could not be found or is not accessible."
      />
    );
  }

  const channelLineups = await api.plex
    .getServerChannelsProgramming({
      machineIdentifier,
      providerIdentifier,
      date: new Date().toISOString().substring(0, 10),
      startTime,
      endTime,
    })
    .catch((error) => {
      console.error(
        `Failed to load channels for server ${machineIdentifier}:`,
        error,
      );
      return [];
    });

  const safeChannelLineups = Array.isArray(channelLineups)
    ? channelLineups
    : [];
  const needsGuideRefresh =
    safeChannelLineups.length === 0 ||
    safeChannelLineups.every((lineup) => lineup.programs.length === 0);

  return (
    <AppPageLayout
      title={`Live TV · ${targetServer.name}`}
      mobileHeader={
        <LibraryHeaderDropdown
          libraryTitle="Live TV"
          serverName={targetServer.name}
          servers={servers}
          userInfo={userInfo}
        />
      }
    >
      {needsGuideRefresh && (
        <LiveTvGuideRefresh
          key={`${machineIdentifier}:${providerIdentifier}`}
          machineIdentifier={machineIdentifier}
          providerIdentifier={providerIdentifier}
        />
      )}
      <TvGuide
        startTime={startTime}
        endTime={endTime}
        channelLineups={safeChannelLineups}
      />
    </AppPageLayout>
  );
}
