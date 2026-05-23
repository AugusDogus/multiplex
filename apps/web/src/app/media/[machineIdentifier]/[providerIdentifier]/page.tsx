import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppHeader } from "~/components/app-header";
import { AppSidebar } from "~/components/app-sidebar";
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

  // Fetch data using tRPC procedures
  const [servers, userInfo] = await Promise.all([
    api.plex.getServers(),
    api.plex.getUserInfo(),
  ] as const);

  if (!servers || !userInfo) {
    return null;
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

  // Find the corresponding source title for the breadcrumb
  const pinnedSources = userInfo.settings?.sidebarSettings?.pinnedSources ?? [];
  const currentSource = pinnedSources.find(
    (pinnedSource) =>
      pinnedSource.machineIdentifier === machineIdentifier &&
      pinnedSource.directoryID === source,
  );

  const breadcrumbTitle = currentSource?.title ?? "Library";

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
              <div className="text-center">
                <h1 className="text-2xl font-bold">Media Library</h1>
                <p className="text-muted-foreground mt-2">
                  Machine ID: {machineIdentifier}
                </p>
                <p className="text-muted-foreground">
                  Provider: {providerIdentifier}
                </p>
                {source && (
                  <p className="text-muted-foreground">Source: {source}</p>
                )}
              </div>
            </div>
          </SidebarInset>
          <MobileNav session={session} servers={servers} userInfo={userInfo} />
        </SidebarProvider>
      </div>
    </HydrateClient>
  );
}
