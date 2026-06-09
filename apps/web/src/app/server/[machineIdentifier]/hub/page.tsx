import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "~/components/app-header";
import { AppSidebar } from "~/components/app-sidebar";
import { HubBrowse } from "~/components/hub-browse";
import { MobileNav } from "~/components/mobile-nav";
import { PlexErrorWrapper } from "~/components/plex-error-wrapper";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { auth } from "~/lib/auth/server";
import { api, HydrateClient } from "~/trpc/server";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
  }>;
  searchParams: Promise<{
    key?: string;
    title?: string;
  }>;
}

export default async function HubPage({ params, searchParams }: PageProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const { machineIdentifier } = await params;
  const { key: hubKey, title } = await searchParams;

  if (!hubKey) {
    notFound();
  }

  const [servers, userInfo, hubContent] = await Promise.all([
    api.plex.getServers(),
    api.plex.getUserInfo(),
    api.plex.getHubContent({
      machineIdentifier,
      hubKey,
      start: 0,
      size: 48,
    }),
  ] as const);

  if (!servers || !userInfo) {
    return null;
  }

  const pageTitle = title ?? "Collection";

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
            <AppHeader>{pageTitle}</AppHeader>
            <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 pb-24 md:pb-4">
              <HubBrowse
                machineIdentifier={machineIdentifier}
                hubKey={hubKey}
                initialContent={hubContent}
              />
            </div>
          </SidebarInset>
          <MobileNav session={session} servers={servers} userInfo={userInfo} />
        </SidebarProvider>
      </div>
    </HydrateClient>
  );
}
