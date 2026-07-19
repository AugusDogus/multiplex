import { AppHeaderSkeleton } from "~/components/app-header-skeleton";
import { AppSidebar } from "~/components/app-sidebar";
import { MobileNav } from "~/components/mobile-nav";
import { NoPlexServers } from "~/components/no-plex-servers";
import { PlexErrorWrapper } from "~/components/plex-error-wrapper";
import { getAppPlexContext } from "~/server/queries/get-app-plex-context";
import { api, HydrateClient } from "~/trpc/server";

export async function AppShellSidebar() {
  const { session, servers, userInfo } = await getAppPlexContext();
  // Prefetch in the sidebar Suspense lane so the 3s+ media-providers fan-out
  // does not compete with home Continue Watching on the client after paint.
  await api.plex.getAllServerLibraries.prefetch();

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

  return children;
}

export function AppContentGateFallback() {
  return <AppHeaderSkeleton showBreadcrumb={false} />;
}
