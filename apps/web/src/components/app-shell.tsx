import { Suspense } from "react";

import { AppHeaderSkeleton } from "~/components/app-header-skeleton";
import { AppSidebar } from "~/components/app-sidebar";
import { MobileNav } from "~/components/mobile-nav";
import { NoPlexServers } from "~/components/no-plex-servers";
import { PlexErrorWrapper } from "~/components/plex-error-wrapper";
import { getAppPlexContext } from "~/server/queries/get-app-plex-context";
import { api, HydrateClient } from "~/trpc/server";

export async function AppShellSidebar() {
  const { session, servers, userInfo } = await getAppPlexContext();
  // Kick libraries off without blocking chrome — pinned sources render from
  // userInfo immediately; full provider lists fill when this settles.
  void api.plex.getAllServerLibraries.prefetch();

  return (
    <HydrateClient>
      <PlexErrorWrapper>
        <AppSidebar session={session} servers={servers} userInfo={userInfo} />
      </PlexErrorWrapper>
    </HydrateClient>
  );
}

export async function AppShellMobileNav() {
  const { session, servers, userInfo } = await getAppPlexContext();

  return <MobileNav session={session} servers={servers} userInfo={userInfo} />;
}

interface AppPlexContentGateProps {
  children: React.ReactNode;
}

export async function AppPlexContentGate({
  children,
}: AppPlexContentGateProps) {
  const { servers } = await getAppPlexContext();

  if (servers.length === 0) {
    return <NoPlexServers />;
  }

  // Nested boundary so page RSC work (library hubs, details, etc.) can show
  // route loading UI instead of extending the shell-gate fallback.
  return <Suspense fallback={<AppContentGateFallback />}>{children}</Suspense>;
}

export function AppContentGateFallback() {
  return <AppHeaderSkeleton showBreadcrumb={false} />;
}
