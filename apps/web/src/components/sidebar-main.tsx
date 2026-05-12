import { Home, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import type { SidebarSource } from "~/hooks/use-sidebar-sources";
import { getSourceIcon, isUrlActive } from "./sidebar-utils";

interface SidebarMainProps {
  pinnedSources: SidebarSource[];
  onShowMore: () => void;
}

export function SidebarMain({ pinnedSources, onShowMore }: SidebarMainProps) {
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

          return (
            <SidebarMenuItem key={source.key}>
              <SidebarMenuButton asChild data-active={isActive}>
                <Link href={source.href}>
                  <Icon />
                  <span>{source.title}</span>
                </Link>
              </SidebarMenuButton>
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
