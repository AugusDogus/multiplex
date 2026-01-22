import { Command } from "lucide-react";
import * as React from "react";

import { Link } from "@tanstack/react-router";
import { NavUser } from "./nav-user";
import { SidebarAll } from "./sidebar-all";
import { SidebarMain } from "./sidebar-main";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";
import { Skeleton } from "./ui/skeleton";
import { TooltipProvider } from "./ui/tooltip";
import { useServerLibraries } from "../hooks/use-server-libraries";
import { useSidebarSources } from "../hooks/use-sidebar-sources";
import type { PlexDevice, PlexUserInfo } from "@multiplex/plex-query";

function NavUserSkeleton() {
  return (
    <div className="flex items-center gap-2 px-2 py-2">
      <Skeleton className="h-8 w-8 rounded-lg" />
      <div className="flex flex-1 flex-col gap-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  );
}

// App version - hardcoded for now, could be imported from package.json
const APP_VERSION = "0.1.0";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user: {
    name: string;
    email: string;
    avatar: string;
  } | null;
  servers: PlexDevice[];
  userInfo: PlexUserInfo | undefined;
  token: string | null;
  isLoading?: boolean;
}

export function AppSidebar({ user, servers, userInfo, token, isLoading, ...props }: AppSidebarProps) {
  const [currentPage, setCurrentPage] = React.useState<"main" | "all">("main");

  // Use custom hooks for data management
  const serverLibraries = useServerLibraries(servers, token);
  const sidebarSources = useSidebarSources(userInfo, serverLibraries);

  // Always render the sidebar structure - show skeleton when no user yet
  // This prevents layout shift during hydration
  const showSkeleton = !user || isLoading;

  return (
    <TooltipProvider>
      <Sidebar variant="inset" {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/">
                  <div className="text-sidebar-primary flex aspect-square size-8 items-center justify-center rounded-lg">
                    <Command className="size-fit dark:text-white" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Multiplex</span>
                    <span className="truncate text-xs">v{APP_VERSION}</span>
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
              isLoading={showSkeleton}
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
          {user ? (
            <NavUser
              user={{
                name: user.name,
                email: user.email,
                avatar: user.avatar,
              }}
              userInfo={userInfo}
            />
          ) : (
            <NavUserSkeleton />
          )}
        </SidebarFooter>
      </Sidebar>
    </TooltipProvider>
  );
}
