import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  getPinnedSourceIdentity,
  isPinnedSource,
  type PlexDevice,
} from "@multiplex/plex-query";
import type { ServerLibraryState } from "~/hooks/use-server-libraries";
import type { SidebarSource } from "~/hooks/use-sidebar-sources";
import { SidebarSourceActionsMenu } from "./sidebar-source-actions-menu";
import { getSourceIcon, isUrlActive } from "./sidebar-utils";

interface ServerLibraryGroupProps {
  server: PlexDevice;
  state: ServerLibraryState;
  pinnedSources: SidebarSource[];
  sources: SidebarSource[];
  pendingSourceIdentity: string | null;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
  onRetry: (serverId: string) => void;
}

export function ServerLibraryGroup({
  server,
  state,
  pinnedSources,
  sources,
  pendingSourceIdentity,
  onTogglePinnedSource,
  onRetry,
}: ServerLibraryGroupProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Loading state
  if (state.isLoading && !state.isRetrying) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel className="flex items-center gap-2">
          {server.name}
          <Loader2 className="h-3 w-3 animate-spin" />
        </SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="text-muted-foreground px-2 py-1 text-xs">
              Loading libraries...
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  // Error state
  if (state.error || state.data?.error || state.data === null) {
    return (
      <SidebarGroup>
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
                type="button"
                onClick={() => onRetry(server.clientIdentifier)}
                disabled={state.isRetrying}
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-6 w-6 items-center justify-center rounded-md disabled:opacity-50"
                aria-label={
                  state.isRetrying
                    ? "Reconnecting to server"
                    : "Retry server connection"
                }
              >
                {state.isRetrying ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{state.isRetrying ? "Reconnecting..." : "Retry connection"}</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="text-muted-foreground px-2 pb-1 text-xs">
              No libraries available
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  // Success state with libraries
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{server.name}</SidebarGroupLabel>
      <SidebarMenu>
        {sources.length === 0 ? (
          <SidebarMenuItem>
            <SidebarMenuButton disabled>
              <span className="text-muted-foreground text-sm">
                No libraries found
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : (
          sources.map((source) => {
            const Icon = getSourceIcon(source.sourceType);
            const isActive = isUrlActive(pathname, searchParams, source.href);
            const sourceIdentity = getPinnedSourceIdentity(source);
            const isPinned = isPinnedSource(pinnedSources, source);
            const isPending = pendingSourceIdentity === sourceIdentity;

            return (
              <SidebarMenuItem key={source.key}>
                <SidebarMenuButton asChild data-active={isActive}>
                  <Link href={source.href} prefetch>
                    <Icon />
                    <span>{source.title}</span>
                  </Link>
                </SidebarMenuButton>
                <SidebarSourceActionsMenu
                  source={source}
                  isPinned={isPinned}
                  isPending={isPending}
                  showOnHover
                  onTogglePinnedSource={onTogglePinnedSource}
                />
              </SidebarMenuItem>
            );
          })
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
