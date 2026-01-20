import { ArrowLeft } from "lucide-react";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import type { UseServerLibrariesReturn } from "~/hooks/use-server-libraries";
import type { UseSidebarSourcesReturn } from "~/hooks/use-sidebar-sources";
import type { PlexDevice } from "~/lib/plex.tv/schemas/plex-tv-schemas";
import { ServerLibraryGroup } from "./server-library-group";

interface SidebarAllProps {
  servers: PlexDevice[];
  serverLibraries: UseServerLibrariesReturn;
  sidebarSources: UseSidebarSourcesReturn;
  onBack: () => void;
}

export function SidebarAll({
  servers,
  serverLibraries,
  sidebarSources,
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
            onRetry={serverLibraries.retryServer}
          />
        );
      })}
    </>
  );
}
