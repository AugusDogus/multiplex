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
  RefreshCw,
  TriangleAlert,
  Tv,
  TvMinimal,
} from "lucide-react";
import * as React from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
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
  const [retryingServers, setRetryingServers] = React.useState<Set<string>>(
    new Set(),
  );
  const pathname = usePathname();

  const pinnedSources = userInfo.settings?.sidebarSettings?.pinnedSources ?? [];

  // Function to retry a specific server
  const retryServer = (serverId: string) => {
    setRetryingServers((prev) => new Set([...prev, serverId]));
    // Simple approach: just reload the page to retry all servers
    setTimeout(() => {
      window.location.reload();
    }, 500); // Small delay to show the loading state
  };

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
    <TooltipProvider>
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
                  <SidebarMenuButton asChild data-active={pathname === "/"}>
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

                  const isActive =
                    pathname === href || pathname.startsWith(href);

                  return (
                    <SidebarMenuItem key={source.key}>
                      <SidebarMenuButton asChild data-active={isActive}>
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
                const isRetrying = retryingServers.has(server.clientIdentifier);

                // Show error state if server couldn't be reached
                if (serverLib?.error) {
                  return (
                    <SidebarGroup key={server.clientIdentifier}>
                      <div className="flex items-center justify-between py-1.5">
                        <SidebarGroupLabel className="flex items-center gap-2">
                          {server.name}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <TriangleAlert className="text-muted-foreground h-3.5 w-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Server offline</p>
                            </TooltipContent>
                          </Tooltip>
                          <span className="sr-only">Server offline</span>
                        </SidebarGroupLabel>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() =>
                                retryServer(server.clientIdentifier)
                              }
                              disabled={isRetrying}
                              className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-6 w-6 items-center justify-center rounded-md disabled:opacity-50"
                              aria-label={
                                isRetrying
                                  ? "Reconnecting to server"
                                  : "Retry server connection"
                              }
                            >
                              {isRetrying ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>
                              {isRetrying
                                ? "Reconnecting..."
                                : "Retry connection"}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      {/* Empty menu to maintain consistent spacing */}
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <div className="text-muted-foreground px-2 py-1 text-xs">
                            No libraries available
                          </div>
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

                          const isActive =
                            pathname === href || pathname.startsWith(href);

                          return (
                            <SidebarMenuItem key={source.key}>
                              <SidebarMenuButton asChild data-active={isActive}>
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
    </TooltipProvider>
  );
}
