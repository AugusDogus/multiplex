"use client";

import { Loader2, MoreHorizontal, Pin, PinOff } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/menu";
import { SidebarMenuAction } from "~/components/ui/sidebar";
import type { SidebarSource } from "~/hooks/use-sidebar-sources";

interface SidebarSourceActionsMenuProps {
  source: SidebarSource;
  isPinned: boolean;
  isPending: boolean;
  showOnHover?: boolean;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
}

export function SidebarSourceActionsMenu({
  source,
  isPinned,
  isPending,
  showOnHover = false,
  onTogglePinnedSource,
}: SidebarSourceActionsMenuProps) {
  function handleTogglePinnedSource() {
    onTogglePinnedSource(source, isPinned ? "unpin" : "pin");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuAction
            showOnHover={showOnHover}
            disabled={isPending}
            aria-label={`${source.title} options`}
          />
        }
      >
        {isPending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleTogglePinnedSource}>
          {isPinned ? <PinOff /> : <Pin />}
          <span>{isPinned ? "Unpin" : "Pin"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
