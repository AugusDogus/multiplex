import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppHeader } from "~/components/app-header";
import { AppSidebar } from "~/components/app-sidebar";
import { PlexErrorWrapper } from "~/components/plex-error-wrapper";
import { TvGuide } from "~/components/tv-guide/tv-guide";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { auth } from "~/lib/auth/server";
import { api, HydrateClient } from "~/trpc/server";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    providerIdentifier: string;
  }>;
}

export default async function LiveTvPage({ params }: PageProps) {
  const { machineIdentifier, providerIdentifier: rawProviderIdentifier } =
    await params;

  // Decode the provider identifier in case it was URL encoded by Next.js
  const providerIdentifier = decodeURIComponent(rawProviderIdentifier);

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  // Calculate time range for TV guide - start from current time, not rounded hour
  const startTime = (() => {
    const start = new Date();
    // Round to nearest 15-minute increment for cleaner timeline
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

  // Fetch data using tRPC procedures - now targeting specific server
  const [servers, userInfo, channelLineups] = await Promise.all([
    api.plex.getServers(),
    api.plex.getUserInfo(),
    api.plex
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
        return []; // Return empty array on error
      }),
  ] as const);

  if (!servers || !userInfo) {
    return null;
  }

  // Validate that the requested server exists
  const targetServer = servers.find(
    (server) => server.clientIdentifier === machineIdentifier,
  );
  if (!targetServer) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Server Not Found</h1>
          <p className="text-muted-foreground mt-2">
            The requested Plex server could not be found or is not accessible.
          </p>
        </div>
      </div>
    );
  }

  // If no servers are configured, show setup message
  if (servers.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome to Multiplex</h1>
          <p className="text-muted-foreground mt-2">
            No Plex servers found. Please configure your Plex account.
          </p>
        </div>
      </div>
    );
  }

  // Ensure channelLineups is an array (handle potential error cases)
  const safeChannelLineups = Array.isArray(channelLineups)
    ? channelLineups
    : [];

  return (
    <HydrateClient>
      <div className="max-w-screen overflow-hidden">
        <SidebarProvider>
          <PlexErrorWrapper>
            <AppSidebar
              session={session}
              servers={servers}
              userInfo={userInfo}
            />
          </PlexErrorWrapper>
          <SidebarInset className="w-0 max-w-full min-w-0 flex-1">
            <AppHeader>Live TV · {targetServer.name}</AppHeader>
            <div className="flex min-w-0 flex-1 flex-col gap-6 p-4">
              <TvGuide
                startTime={startTime}
                endTime={endTime}
                channelLineups={safeChannelLineups}
              />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </HydrateClient>
  );
}
