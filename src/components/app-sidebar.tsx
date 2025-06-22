"use client";
import * as packageJson from "~/../package.json";

import {
  ArrowLeft,
  Command,
  Film,
  Home,
  ListVideo,
  MoreHorizontal,
  Music,
  Play,
  Tv,
  TvMinimal,
} from "lucide-react";
import * as React from "react";

import Link from "next/link";
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
import {
  createSourceFromExtractedSource,
  extractAllSources,
} from "~/lib/plex.tv/utils";
import type { plexRouterOutputs } from "~/server/api/routers/plex";

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
  serverLibraries: plexRouterOutputs["getAllServerLibraries"];
}

// Helper function to get the appropriate icon for a source type
function getSourceIcon(sourceType: string) {
  switch (sourceType) {
    case "movies":
      return Film;
    case "tv":
      return TvMinimal;
    case "music":
      return Music;
    case "playlist":
      return ListVideo;
    case "Live TV & DVR":
      return Tv;
    default:
      return Play;
  }
}

export function AppSidebar({
  session,
  servers,
  userInfo,
  serverLibraries,
  ...props
}: AppSidebarProps) {
  const [currentPage, setCurrentPage] = React.useState<"main" | "all">("main");

  const pinnedSources = userInfo.settings?.sidebarSettings?.pinnedSources ?? [];

  // Extract all sources from server libraries
  const allLibrarySources = React.useMemo(() => {
    const sources: ReturnType<typeof createSourceFromExtractedSource>[] = [];

    for (const serverLib of serverLibraries) {
      if (serverLib.mediaProviders && !serverLib.error) {
        try {
          const extractedSources = extractAllSources(serverLib.mediaProviders);

          for (const extractedSource of extractedSources) {
            const source = createSourceFromExtractedSource(
              extractedSource,
              serverLib.serverId,
              serverLib.serverName,
            );
            sources.push(source);
          }
        } catch (error) {
          console.error(
            `Error processing server ${serverLib.serverName}:`,
            error,
          );
        }
      }
    }

    return sources;
  }, [serverLibraries]);

  // Match pinned sources with real library sources
  const matchedPinnedSources = React.useMemo(() => {
    const matched = pinnedSources.map((pinnedSource) => {
      // Try to find a matching library source
      const matchingLibrarySource = allLibrarySources.find(
        (libSource) =>
          libSource.machineIdentifier === pinnedSource.machineIdentifier &&
          libSource.directoryID === pinnedSource.directoryID,
      );

      // Use the library source if found, otherwise fall back to pinned source
      return (
        matchingLibrarySource ?? {
          key: pinnedSource.key,
          sourceType: pinnedSource.sourceType,
          machineIdentifier: pinnedSource.machineIdentifier,
          directoryID: pinnedSource.directoryID,
          title: pinnedSource.title,
          serverFriendlyName: pinnedSource.serverFriendlyName,
          isLibrarySection: false,
        }
      );
    });

    return matched;
  }, [pinnedSources, allLibrarySources]);

  // Group all library sources by server for the "More" page
  const librarySourcesByServer = React.useMemo(() => {
    const grouped: Record<string, typeof allLibrarySources> = {};

    for (const source of allLibrarySources) {
      grouped[source.machineIdentifier] ??= [];
      grouped[source.machineIdentifier]!.push(source);
    }

    return grouped;
  }, [allLibrarySources]);

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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
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
          <SidebarGroup>
            <SidebarMenu>
              {/* Home Item */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link href="/">
                    <Home />
                    <span>Home</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Pinned Sources (now using real library data) */}
              {matchedPinnedSources.map((source) => {
                const Icon = getSourceIcon(source.sourceType);
                // Generate href for pinned sources that might not have it
                const href =
                  "href" in source && source.href
                    ? source.href
                    : `/media/${source.machineIdentifier}/com.plexapp.plugins.library?source=${source.directoryID}`;

                return (
                  <SidebarMenuItem key={source.key}>
                    <SidebarMenuButton asChild>
                      <Link href={href}>
                        <Icon />
                        <span>{source.title}</span>
                      </Link>
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

            {/* All Sources Grouped by Server (now using real library data) */}
            {servers.map((server) => {
              const serverSources =
                librarySourcesByServer[server.clientIdentifier] ?? [];
              const serverLib = serverLibraries.find(
                (lib) => lib.serverId === server.clientIdentifier,
              );

              // Show error state if server couldn't be reached
              if (serverLib?.error) {
                return (
                  <SidebarGroup key={server.clientIdentifier}>
                    <SidebarGroupLabel>{server.name}</SidebarGroupLabel>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton disabled>
                          <span className="text-muted-foreground text-sm">
                            Error: {serverLib.error}
                          </span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroup>
                );
              }

              // Show library sections for this server
              return (
                <SidebarGroup key={server.clientIdentifier}>
                  <SidebarGroupLabel>{server.name}</SidebarGroupLabel>
                  <SidebarMenu>
                    {serverSources.length === 0 ? (
                      <SidebarMenuItem>
                        <SidebarMenuButton disabled>
                          <span className="text-muted-foreground text-sm">
                            No libraries found
                          </span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ) : (
                      serverSources.map((source) => {
                        const Icon = getSourceIcon(source.sourceType);
                        const href =
                          "href" in source && source.href
                            ? source.href
                            : `/media/${source.machineIdentifier}/com.plexapp.plugins.library?source=${source.directoryID}`;

                        return (
                          <SidebarMenuItem key={source.key}>
                            <SidebarMenuButton asChild>
                              <Link href={href}>
                                <Icon />
                                <span>{source.title}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })
                    )}
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
