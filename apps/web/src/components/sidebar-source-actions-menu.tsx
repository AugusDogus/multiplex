"use client";

import { Loader2, MoreHorizontal, Pin, PinOff } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SidebarMenuAction } from "~/components/ui/sidebar";
import type { SidebarSource } from "~/hooks/use-sidebar-sources";

interface SidebarSourceActionsMenuProps {
  source: SidebarSource;
  isPinned: boolean;
  isPending: boolean;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
}

export function SidebarSourceActionsMenu({
  source,
  isPinned,
  isPending,
  onTogglePinnedSource,
}: SidebarSourceActionsMenuProps) {
  function handleTogglePinnedSource() {
    onTogglePinnedSource(source, isPinned ? "unpin" : "pin");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction
          showOnHover
          disabled={isPending}
          aria-label={`${source.title} options`}
        >
          {isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <MoreHorizontal />
          )}
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={handleTogglePinnedSource}>
          {isPinned ? <PinOff /> : <Pin />}
          <span>{isPinned ? "Unpin" : "Pin"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
