import { Home, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { getPinnedSourceIdentity } from "@multiplex/plex-query";
import { useLibraryNavigationPrefetch } from "~/hooks/use-library-navigation-prefetch";
import type { SidebarSource } from "~/hooks/use-sidebar-sources";
import { SidebarSourceActionsMenu } from "./sidebar-source-actions-menu";
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
  const { prefetchLibrary } = useLibraryNavigationPrefetch();

  return (
    <SidebarGroup>
      <SidebarMenu>
        {/* Home Item */}
        <SidebarMenuItem>
          <SidebarMenuButton
            render={<Link href="/" />}
            isActive={pathname === "/"}
          >
            <Home />
            <span>Home</span>
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
              <SidebarMenuButton
                render={
                  <Link
                    href={source.href}
                    prefetch
                    onMouseEnter={() => prefetchLibrary(source.href)}
                    onFocus={() => prefetchLibrary(source.href)}
                    onTouchStart={() => prefetchLibrary(source.href)}
                  />
                }
                isActive={isActive}
              >
                <Icon />
                <span>{source.title}</span>
              </SidebarMenuButton>
              <SidebarSourceActionsMenu
                source={source}
                isPinned
                isPending={isPending}
                showOnHover
                onTogglePinnedSource={onTogglePinnedSource}
              />
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
