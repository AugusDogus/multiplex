import { ChevronsUpDown } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import type { AuthHint } from "~/lib/auth/auth-hint";

/**
 * Layout-stable profile chrome for the sidebar skeleton. Matches NavUser's
 * closed trigger so swapping to the real menu doesn't jump.
 */
export function SidebarUserSlot({ hint }: { hint: AuthHint | null }) {
  if (!hint) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="pointer-events-none">
            <div className="bg-sidebar-accent h-8 w-8 shrink-0 rounded-lg" />
            <div className="grid flex-1 gap-1.5 text-left">
              <div className="bg-sidebar-accent h-3.5 w-24 rounded" />
              <div className="bg-sidebar-accent h-3 w-32 rounded" />
            </div>
            <ChevronsUpDown className="ml-auto size-4 opacity-0" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const initials = hint.name
    .split(" ")
    .map((part) => part[0])
    .join("");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="pointer-events-none">
          <Avatar className="h-8 w-8 rounded-lg">
            {hint.image ? (
              <AvatarImage src={hint.image} alt={hint.name} />
            ) : null}
            <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{hint.name}</span>
            <span className="truncate text-xs">{hint.email ?? ""}</span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 opacity-40" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
