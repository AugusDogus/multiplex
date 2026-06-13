import { AppHeaderSkeleton } from "~/components/app-header-skeleton";
import { AppSidebar } from "~/components/app-sidebar";
import { MobileNav } from "~/components/mobile-nav";
import { NoPlexServers } from "~/components/no-plex-servers";
import { PlexErrorWrapper } from "~/components/plex-error-wrapper";
import { getAppPlexContext } from "~/server/queries/get-app-plex-context";

export async function AppShellSidebar() {
  const { session, servers, userInfo } = await getAppPlexContext();

  return (
    <PlexErrorWrapper>
      <AppSidebar session={session} servers={servers} userInfo={userInfo} />
    </PlexErrorWrapper>
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
