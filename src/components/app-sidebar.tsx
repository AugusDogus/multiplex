"use client";
import * as packageJson from "~/../package.json";

import {
  ArrowLeft,
  Command,
  Film,
  Home,
  MoreHorizontal,
  Music,
  Play,
  Tv,
} from "lucide-react";
import * as React from "react";

import { NavUser } from "~/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
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

// Helper function to get the appropriate icon for a source type
function getSourceIcon(sourceType: string) {
  switch (sourceType) {
    case "movies":
      return Film;
    case "tv":
      return Tv;
    case "music":
      return Music;
    default:
      return Play;
  }
}

export function AppSidebar({
  session,
  servers,
  userInfo,
  ...props
}: AppSidebarProps) {
  const [currentPage, setCurrentPage] = React.useState<"main" | "all">("main");

  if (!session) {
    return null;
  }

  const user = {
    name: session.user.name,
    email: session.user.email,
    avatar: session.user.image ?? "",
  };

  const pinnedSources = userInfo.settings?.sidebarSettings?.pinnedSources ?? [];

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/dashboard">
                <div className="text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Command className="size-fit dark:text-white" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Multiplex</span>
                  <span className="truncate text-xs">
                    v{packageJson.version}
                  </span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {currentPage === "main" ? (
          <SidebarGroup>
            <SidebarMenu>
              {/* Home Item */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/dashboard">
                    <Home />
                    <span>Home</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Pinned Sources */}
              {pinnedSources.map((source) => {
                const Icon = getSourceIcon(source.sourceType);
                return (
                  <SidebarMenuItem key={source.key}>
                    <SidebarMenuButton asChild>
                      <a
                        href={`/server/${source.machineIdentifier}/library/${source.directoryID}`}
                      >
                        <Icon />
                        <span>{source.title}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}

              {/* More Button */}
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => setCurrentPage("all")}>
                  <MoreHorizontal />
                  <span>More</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        ) : (
          <>
            {/* Back Button */}
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => setCurrentPage("main")}>
                    <ArrowLeft />
                    <span>Back</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>

            {/* All Sources Grouped by Server */}
            {servers.map((server) => {
              // Filter to get only library sections for this server
              const serverSources = pinnedSources.filter(
                (source) =>
                  source.machineIdentifier === server.clientIdentifier,
              );

              // For now, we'll show the pinned sources. In a real implementation,
              // you'd want to fetch all library sections from the server
              // This is a placeholder structure
              return (
                <SidebarGroup key={server.clientIdentifier}>
                  <SidebarGroupLabel>{server.name}</SidebarGroupLabel>
                  <SidebarMenu>
                    {serverSources.map((source) => {
                      const Icon = getSourceIcon(source.sourceType);
                      return (
                        <SidebarMenuItem key={source.key}>
                          <SidebarMenuButton asChild>
                            <a
                              href={`/server/${source.machineIdentifier}/library/${source.directoryID}`}
                            >
                              <Icon />
                              <span>{source.title}</span>
                            </a>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroup>
              );
            })}
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
