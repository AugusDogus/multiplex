"use client";
import packageJson from "~/../package.json";

import { Command } from "lucide-react";
import * as React from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import {
  useSidebarSources,
  type SidebarSource,
} from "~/hooks/use-sidebar-sources";
import {
  getPinnedSourceIdentity,
  type PinnedSource,
  type PlexDevice,
  type PlexUserInfo,
} from "@multiplex/plex-query";
import { api } from "~/trpc/react";

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
  const [currentUserInfo, setCurrentUserInfo] = React.useState(userInfo);
  const router = useRouter();
  const utils = api.useUtils();

  React.useEffect(() => {
    setCurrentUserInfo(userInfo);
  }, [userInfo]);

  // Use custom hooks for data management
  const serverLibraries = useServerLibraries(servers);
  const sidebarSources = useSidebarSources(currentUserInfo, serverLibraries);
  const pinnedSourceIdentities = React.useMemo(
    () =>
      new Set(
        sidebarSources.pinnedSources.map((source) =>
          getPinnedSourceIdentity(source),
        ),
      ),
    [sidebarSources.pinnedSources],
  );
  const togglePinnedSourceMutation = api.plex.togglePinnedSource.useMutation({
    onSuccess: async (updatedUserInfo) => {
      setCurrentUserInfo(updatedUserInfo);
      await Promise.all([
        utils.plex.getUserInfo.invalidate(),
        utils.plex.getAllContinueWatching.invalidate(),
      ]);
      router.refresh();
    },
  });

  const pendingSourceIdentity = togglePinnedSourceMutation.variables
    ? getPinnedSourceIdentity(togglePinnedSourceMutation.variables.source)
    : null;

  const handleTogglePinnedSource = React.useCallback(
    (source: SidebarSource, action: "pin" | "unpin") => {
      const pinnedSource: PinnedSource = {
        key: source.key,
        sourceType: source.sourceType,
        machineIdentifier: source.machineIdentifier,
        providerIdentifier: source.providerIdentifier,
        directoryID: source.directoryID,
        title: source.title,
        serverFriendlyName: source.serverFriendlyName,
        ...(source.serverSourceTitle !== undefined
          ? { serverSourceTitle: source.serverSourceTitle }
          : {}),
        ...(source.providerSourceTitle !== undefined
          ? { providerSourceTitle: source.providerSourceTitle }
          : {}),
        ...(source.directoryIcon !== undefined
          ? { directoryIcon: source.directoryIcon }
          : {}),
        ...(source.isCloud !== undefined ? { isCloud: source.isCloud } : {}),
        ...(source.hiddenAt !== undefined ? { hiddenAt: source.hiddenAt } : {}),
        isFullOwnedServer: source.isFullOwnedServer,
      };

      togglePinnedSourceMutation.mutate({
        action,
        source: pinnedSource,
      });
    },
    [togglePinnedSourceMutation],
  );

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
              pinnedSourceIdentities={pinnedSourceIdentities}
              onTogglePinnedSource={handleTogglePinnedSource}
              onBack={() => setCurrentPage("main")}
            />
          )}
        </SidebarContent>

        <SidebarFooter>
          <NavUser user={user} userInfo={currentUserInfo} />
        </SidebarFooter>
      </Sidebar>
    </TooltipProvider>
  );
}
