import type { ReactNode } from "react";
import type { PlexDevice, PlexUserInfo } from "@multiplex/plex-query";
import { AppHeader } from "~/components/app-header";
import { AppSidebar } from "~/components/app-sidebar";
import { MobileNav } from "~/components/mobile-nav";
import { PlexErrorWrapper } from "~/components/plex-error-wrapper";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { HydrateClient } from "~/trpc/server";

interface LibraryPageShellProps {
  session: {
    user: {
      name: string;
      email: string;
      image?: string | null;
    };
  };
  servers: PlexDevice[];
  userInfo: PlexUserInfo;
  title: string;
  mobileHeader?: ReactNode;
  children: ReactNode;
}

export function LibraryPageShell({
  session,
  servers,
  userInfo,
  title,
  mobileHeader,
  children,
}: LibraryPageShellProps) {
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
            <AppHeader mobile={mobileHeader}>{title}</AppHeader>
            <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 pb-24 md:pb-4">
              {children}
            </div>
          </SidebarInset>
          <MobileNav session={session} servers={servers} userInfo={userInfo} />
        </SidebarProvider>
      </div>
    </HydrateClient>
  );
}
