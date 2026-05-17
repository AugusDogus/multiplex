import { ArrowLeft } from "lucide-react";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import type { UseServerLibrariesReturn } from "~/hooks/use-server-libraries";
import type {
  SidebarSource,
  UseSidebarSourcesReturn,
} from "~/hooks/use-sidebar-sources";
import type { PlexDevice } from "@multiplex/plex-query";
import { ServerLibraryGroup } from "./server-library-group";

interface SidebarAllProps {
  servers: PlexDevice[];
  serverLibraries: UseServerLibrariesReturn;
  sidebarSources: UseSidebarSourcesReturn;
  pendingSourceIdentity: string | null;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
  onBack: () => void;
}

export function SidebarAll({
  servers,
  serverLibraries,
  sidebarSources,
  pendingSourceIdentity,
  onTogglePinnedSource,
  onBack,
}: SidebarAllProps) {
  return (
    <>
      {/* Back Button */}
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onBack}>
              <ArrowLeft />
              <span>Back</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      {/* All Servers */}
      {servers.map((server) => {
        const state = serverLibraries.serverStates.get(server.clientIdentifier);
        const sources =
          sidebarSources.librarySourcesByServer[server.clientIdentifier] ?? [];

        if (!state) return null;

        return (
          <ServerLibraryGroup
            key={server.clientIdentifier}
            server={server}
            state={state}
            sources={sources}
            pinnedSources={sidebarSources.pinnedSources}
            pendingSourceIdentity={pendingSourceIdentity}
            onTogglePinnedSource={onTogglePinnedSource}
            onRetry={serverLibraries.retryServer}
          />
        );
      })}
    </>
  );
}
