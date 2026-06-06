import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppHeader } from "~/components/app-header";
import { AppSidebar } from "~/components/app-sidebar";
import { MediaItemDetails } from "~/components/media-item-details";
import { MobileNav } from "~/components/mobile-nav";
import { PlexErrorWrapper } from "~/components/plex-error-wrapper";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { auth } from "~/lib/auth/server";
import { api, HydrateClient } from "~/trpc/server";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    ratingKey: string;
  }>;
}

export default async function MediaItemPage({ params }: PageProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const { machineIdentifier, ratingKey } = await params;
  const [servers, userInfo, details] = await Promise.all([
    api.plex.getServers(),
    api.plex.getUserInfo(),
    api.plex.getItemDetails({
      serverId: machineIdentifier,
      ratingKey,
    }),
  ] as const);

  if (!servers || !userInfo) {
    return null;
  }

  if (!details) {
    notFound();
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
            <AppHeader>{details.item.title}</AppHeader>
            <main className="flex min-w-0 flex-1 flex-col p-4">
              <MediaItemDetails
                details={details}
                serverId={machineIdentifier}
              />
            </main>
          </SidebarInset>
          <MobileNav session={session} servers={servers} userInfo={userInfo} />
        </SidebarProvider>
      </div>
    </HydrateClient>
  );
}
