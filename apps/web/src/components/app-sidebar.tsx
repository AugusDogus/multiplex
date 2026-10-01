"use client";
import { SidebarBrand } from "~/components/sidebar-brand";

import { type ComponentProps, useState } from "react";
import { NavUser } from "~/components/nav-user";
import { SidebarAll } from "~/components/sidebar-all";
import { SidebarMain } from "~/components/sidebar-main";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "~/components/ui/sidebar";
import { useSidebarPinning } from "~/hooks/use-sidebar-pinning";
import { useServerLibraries } from "~/hooks/use-server-libraries";
import { getSidebarSources } from "~/hooks/use-sidebar-sources";
import type { PlexDevice, PlexUserInfo } from "@multiplex/plex-query";

interface AppSidebarProps extends ComponentProps<typeof Sidebar> {
  session: {
    user: {
      name: string;
      email: string;
      image?: string | null;
    };
  } | null;
  servers: PlexDevice[];
  userInfo: PlexUserInfo;
}

export function AppSidebar({
  session,
  servers,
  userInfo,
  ...props
}: AppSidebarProps) {
  const [currentPage, setCurrentPage] = useState<"main" | "all">("main");
  const { currentUserInfo, pendingSourceIdentity, handleTogglePinnedSource } =
    useSidebarPinning(userInfo);

  // Use custom hooks for data management
  const serverLibraries = useServerLibraries(servers);
  const sidebarSources = getSidebarSources(currentUserInfo, serverLibraries);

  if (!session) {
    return null;
  }

  const user = {
    name: session.user.name,
    email: session.user.email,
    avatar: session.user.image ?? "",
  };

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarBrand />
      </SidebarHeader>

      <SidebarContent>
        {currentPage === "main" ? (
          <SidebarMain
            pinnedSources={sidebarSources.pinnedSources}
            pendingSourceIdentity={pendingSourceIdentity}
            onTogglePinnedSource={handleTogglePinnedSource}
            onShowMore={() => setCurrentPage("all")}
          />
        ) : (
          <SidebarAll
            servers={servers}
            serverLibraries={serverLibraries}
            sidebarSources={sidebarSources}
            pendingSourceIdentity={pendingSourceIdentity}
            onTogglePinnedSource={handleTogglePinnedSource}
            onBack={() => setCurrentPage("main")}
          />
        )}
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} userInfo={currentUserInfo} />
      </SidebarFooter>
    </Sidebar>
  );
}
