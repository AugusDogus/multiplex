import { Home, Loader2, MoreHorizontal, PinOff } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { getPinnedSourceIdentity } from "@multiplex/plex-query";
import type { SidebarSource } from "~/hooks/use-sidebar-sources";
import { getSourceIcon, isUrlActive } from "./sidebar-utils";

interface SidebarMainProps {
  pinnedSources: SidebarSource[];
  pendingSourceIdentity: string | null;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
  onShowMore: () => void;
}

export function SidebarMain({
  pinnedSources,
  pendingSourceIdentity,
  onTogglePinnedSource,
  onShowMore,
}: SidebarMainProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
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

        {/* Pinned Sources */}
        {pinnedSources.map((source) => {
          const Icon = getSourceIcon(source.sourceType);
          const isActive = isUrlActive(pathname, searchParams, source.href);
          const isPending =
            pendingSourceIdentity === getPinnedSourceIdentity(source);

          return (
            <SidebarMenuItem key={source.key}>
              <SidebarMenuButton asChild data-active={isActive}>
                <Link href={source.href}>
                  <Icon />
                  <span>{source.title}</span>
                </Link>
              </SidebarMenuButton>
              <SidebarMenuAction
                showOnHover
                disabled={isPending}
                aria-label={`Unpin ${source.title}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onTogglePinnedSource(source, "unpin");
                }}
              >
                {isPending ? <Loader2 className="animate-spin" /> : <PinOff />}
              </SidebarMenuAction>
            </SidebarMenuItem>
          );
        })}

        {/* More Button */}
        <SidebarMenuItem>
          <SidebarMenuButton onClick={onShowMore}>
            <MoreHorizontal />
            <span>More</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
