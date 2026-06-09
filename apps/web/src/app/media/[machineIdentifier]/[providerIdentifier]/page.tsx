import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSourceFromExtractedSource,
  extractAllSources,
} from "@multiplex/plex-query";
import { AppHeader } from "~/components/app-header";
import { AppSidebar } from "~/components/app-sidebar";
import { LibraryBrowse } from "~/components/library-browse";
import { LibraryHeaderDropdown } from "~/components/library-header-dropdown";
import { MobileNav } from "~/components/mobile-nav";
import { PlexErrorWrapper } from "~/components/plex-error-wrapper";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { auth } from "~/lib/auth/server";
import { api, HydrateClient } from "~/trpc/server";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    providerIdentifier: string;
  }>;
  searchParams: Promise<{
    source?: string;
  }>;
}

export default async function MediaLibraryPage({
  params,
  searchParams,
}: PageProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const { machineIdentifier, providerIdentifier } = await params;
  const { source } = await searchParams;

  const [servers, userInfo] = await Promise.all([
    api.plex.getServers(),
    api.plex.getUserInfo(),
  ] as const);

  if (!servers || !userInfo) {
    return null;
  }

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

  const currentServer = servers.find(
    (server) => server.clientIdentifier === machineIdentifier,
  );
  const serverName = currentServer?.name ?? "Plex server";

  const pinnedSources = userInfo.settings?.sidebarSettings?.pinnedSources ?? [];
  const pinnedSource = pinnedSources.find(
    (pinned) =>
      pinned.machineIdentifier === machineIdentifier &&
      pinned.directoryID === source,
  );

  let breadcrumbTitle = pinnedSource?.title ?? "Library";

  if (!source) {
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
              <AppHeader>{breadcrumbTitle}</AppHeader>
              <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 pb-24 md:pb-4">
                <p className="text-muted-foreground text-sm">
                  Select a library from the sidebar to browse your collection.
                </p>
              </div>
            </SidebarInset>
            <MobileNav
              session={session}
              servers={servers}
              userInfo={userInfo}
            />
          </SidebarProvider>
        </div>
      </HydrateClient>
    );
  }

  const [libraryHubs, libraryContent, serverLibraries] = await Promise.all([
    api.plex.getLibraryHubs({ machineIdentifier, sectionId: source }),
    api.plex.getLibraryContent({
      machineIdentifier,
      sectionId: source,
      start: 0,
      size: 24,
    }),
    api.plex.getAllServerLibraries(),
  ]);

  if (!breadcrumbTitle || breadcrumbTitle === "Library") {
    const serverLibrary = serverLibraries.find(
      (entry) => entry.serverId === machineIdentifier,
    );
    if (serverLibrary?.mediaProviders) {
      const sources = extractAllSources(serverLibrary.mediaProviders).map(
        (extracted) =>
          createSourceFromExtractedSource(
            extracted,
            machineIdentifier,
            serverName,
            serverLibrary.serverOwned,
          ),
      );
      const matchedSource = sources.find(
        (entry) =>
          entry.providerIdentifier === providerIdentifier &&
          entry.directoryID === source,
      );
      if (matchedSource) {
        breadcrumbTitle = matchedSource.title;
      }
    }
  }

  if (libraryContent.librarySectionTitle) {
    breadcrumbTitle = libraryContent.librarySectionTitle;
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
            <AppHeader
              mobile={
                <LibraryHeaderDropdown
                  libraryTitle={breadcrumbTitle}
                  serverName={serverName}
                  servers={servers}
                  userInfo={userInfo}
                />
              }
            >
              {breadcrumbTitle}
            </AppHeader>
            <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 pb-24 md:pb-4">
              <LibraryBrowse
                machineIdentifier={machineIdentifier}
                sectionId={source}
                initialHubs={libraryHubs}
                initialContent={libraryContent}
              />
            </div>
          </SidebarInset>
          <MobileNav session={session} servers={servers} userInfo={userInfo} />
        </SidebarProvider>
      </div>
    </HydrateClient>
  );
}
