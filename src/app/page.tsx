import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "~/components/app-sidebar";
import { ContinueWatching } from "~/components/continue-watching";
import { PlexErrorWrapper } from "~/components/plex-error-wrapper";
import { SearchForm } from "~/components/search-form";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Separator } from "~/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { auth } from "~/lib/auth/server";
import type { ContinueWatchingItem } from "~/lib/plex.tv/continue-watching-schemas";
import type { PinnedSource } from "~/lib/plex.tv/schemas";
import { api, HydrateClient } from "~/trpc/server";

async function getContinueWatchingData(limit = 10) {
  try {
    // Get servers and user info
    const [servers, userInfo] = await Promise.all([
      api.plex.getServers(),
      api.plex.getUserInfo(),
    ]);

    if (!servers || !userInfo) {
      return [];
    }

    // Extract pinned sources from user settings
    const pinnedSources =
      userInfo.settings?.sidebarSettings?.pinnedSources ?? [];

    if (pinnedSources.length === 0) {
      return [];
    }

    // Group pinned sources by server (machineIdentifier)
    const sourcesByServer = pinnedSources.reduce(
      (acc, source) => {
        acc[source.machineIdentifier] ??= [];
        acc[source.machineIdentifier]!.push(source);
        return acc;
      },
      {} as Record<string, PinnedSource[]>,
    );

    // Fetch Continue Watching from each server that has pinned sources
    const serverPromises = Object.entries(sourcesByServer).map(
      async ([machineIdentifier, sources]) => {
        try {
          // Find the server
          const server = servers.find(
            (s) => s.clientIdentifier === machineIdentifier,
          );
          if (!server) {
            console.warn(
              `Server not found for machineIdentifier: ${machineIdentifier}`,
            );
            return null;
          }

          // Extract directory IDs from pinned sources
          const directoryIds = sources.map((source) => source.directoryID);

          // Call TRPC endpoint to get Continue Watching for this server
          const response = await api.plex.getContinueWatching({
            serverId: machineIdentifier,
            contentDirectoryIds: directoryIds,
          });

          return { response, server };
        } catch (error) {
          console.error(
            `Failed to fetch Continue Watching for server ${machineIdentifier}:`,
            error,
          );
          return null;
        }
      },
    );

    const serverResults = (await Promise.all(serverPromises)).filter(
      (result): result is { response: any; server: any } => result !== null,
    );

    // Combine all items from all servers with server connection info
    const allItems = serverResults.flatMap(({ response, server }) => {
      // Prefer Plex Direct HTTPS connections for thumbnails to avoid mixed content issues
      const plexDirectConnection = server.connections?.find(
        (conn: any) =>
          conn.uri.includes(".plex.direct") && conn.uri.startsWith("https:"),
      );

      const customDomainNoPortConnection = server.connections?.find(
        (conn: any) =>
          conn.uri.startsWith("https:") &&
          !conn.uri.includes(".plex.direct") &&
          !/:\d+$/.exec(conn.uri),
      );

      const httpsConnection = server.connections?.find((conn: any) =>
        conn.uri.startsWith("https:"),
      );

      let serverUrl =
        plexDirectConnection?.uri ??
        customDomainNoPortConnection?.uri ??
        httpsConnection?.uri ??
        server.connections?.[0]?.uri;

      // If we ended up with a custom domain that has a port, remove it
      if (
        serverUrl &&
        !serverUrl.includes(".plex.direct") &&
        /:\d+$/.exec(serverUrl)
      ) {
        serverUrl = serverUrl.replace(/:\d+$/, "");
      }

      const authToken = server.accessToken ?? userInfo.authToken;

      return response.items.map((item: ContinueWatchingItem) => ({
        ...item,
        serverUrl,
        authToken,
      }));
    });

    // Sort by most recently watched
    const sortedItems = allItems.sort((a, b) => {
      const aTime = a.lastViewedAt?.getTime() ?? 0;
      const bTime = b.lastViewedAt?.getTime() ?? 0;
      return bTime - aTime;
    });

    // Apply limit
    return sortedItems.slice(0, limit);
  } catch (error) {
    console.error("Failed to fetch Continue Watching data:", error);
    return [];
  }
}

export default async function Page() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  // Fetch basic server and user info first
  const promises = [
    api.plex.getServers(),
    api.plex.getUserInfo(),
    getContinueWatchingData(10),
  ] as const;
  const [servers, userInfo, continueWatchingItems] =
    await Promise.all(promises);

  if (!servers || !userInfo) {
    return null;
  }

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
            <header className="flex h-16 shrink-0 items-center gap-2">
              <div className="flex w-full items-center gap-2 px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator
                  orientation="vertical"
                  className="mr-2 data-[orientation=vertical]:h-4"
                />
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink href="#">Home</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>Dashboard</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
                <SearchForm className="w-full sm:ml-auto sm:w-auto" />
              </div>
            </header>
            <div className="flex min-w-0 flex-1 flex-col gap-6">
              <ContinueWatching items={continueWatchingItems} />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </HydrateClient>
  );
}
