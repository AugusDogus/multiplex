import { Home, MoreHorizontal } from "lucide-react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "./ui/sidebar";
import type { SidebarSource } from "../hooks/use-sidebar-sources";
import { getSourceIcon, isUrlActive } from "./sidebar-utils";

interface SidebarMainProps {
  pinnedSources: SidebarSource[];
  onShowMore: () => void;
  isLoading?: boolean;
}

export function SidebarMain({ pinnedSources, onShowMore, isLoading }: SidebarMainProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const searchParams = new URLSearchParams(location.search);

  return (
    <SidebarGroup>
      <SidebarMenu>
        {/* Home Item */}
        <SidebarMenuItem>
          <SidebarMenuButton asChild data-active={pathname === "/"}>
            <Link to="/">
              <Home />
              <span>Home</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>

        {/* Loading Skeletons - show when loading, regardless of pinnedSources */}
        {isLoading ? (
          <>
            {/* Use deterministic widths to avoid hydration mismatch */}
            {[70, 55, 80, 65].map((width, i) => (
              <SidebarMenuItem key={`skeleton-${i}`}>
                <SidebarMenuSkeleton showIcon width={`${width}%`} />
              </SidebarMenuItem>
            ))}
          </>
        ) : (
          /* Pinned Sources - only show when not loading */
          pinnedSources.map((source) => {
          const Icon = getSourceIcon(source.sourceType);
          const isActive = isUrlActive(pathname, searchParams, source.href);

          return (
            <SidebarMenuItem key={source.key}>
              <SidebarMenuButton asChild data-active={isActive}>
                <a href={source.href}>
                  <Icon />
                  <span>{source.title}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })
        )}

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
