"use client";
import packageJson from "~/../package.json";

import { Command } from "lucide-react";
import * as React from "react";

import Link from "next/link";
import { NavUser } from "~/components/nav-user";
import { SidebarAll } from "~/components/sidebar-all";
import { SidebarMain } from "~/components/sidebar-main";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { TooltipProvider } from "~/components/ui/tooltip";
import { useServerLibraries } from "~/hooks/use-server-libraries";
import { useSidebarSources } from "~/hooks/use-sidebar-sources";
import type { PlexDevice, PlexUserInfo } from "~/lib/plex.tv/schemas";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
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
  const [currentPage, setCurrentPage] = React.useState<"main" | "all">("main");

  // Use custom hooks for data management
  const serverLibraries = useServerLibraries(servers);
  const sidebarSources = useSidebarSources(userInfo, serverLibraries);

  if (!session) {
    return null;
  }

  const user = {
    name: session.user.name,
    email: session.user.email,
    avatar: session.user.image ?? "",
  };

  return (
    <TooltipProvider>
      <Sidebar variant="inset" {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link href="/">
                  <div className="text-sidebar-primary flex aspect-square size-8 items-center justify-center rounded-lg">
                    <Command className="size-fit dark:text-white" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Multiplex</span>
                    <span className="truncate text-xs">
                      v{packageJson.version}
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {currentPage === "main" ? (
            <SidebarMain
              pinnedSources={sidebarSources.pinnedSources}
              onShowMore={() => setCurrentPage("all")}
            />
          ) : (
            <SidebarAll
              servers={servers}
              serverLibraries={serverLibraries}
              sidebarSources={sidebarSources}
              onBack={() => setCurrentPage("main")}
            />
          )}
        </SidebarContent>

        <SidebarFooter>
          <NavUser user={user} userInfo={userInfo} />
        </SidebarFooter>
      </Sidebar>
    </TooltipProvider>
  );
}
