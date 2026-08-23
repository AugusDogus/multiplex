"use client";

import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/menu";

interface PlaylistPosterActionsMenuProps {
  href: string;
  title: string;
}

export function PlaylistPosterActionsMenu({
  href,
  title,
}: PlaylistPosterActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const prefetch = () => router.prefetch(href);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="glass"
            size="icon-sm"
            className="rounded-full shadow-lg transition-transform duration-150 ease-out active:scale-[0.97]"
            aria-label={`More actions for ${title}`}
          />
        }
        onFocus={prefetch}
        onMouseEnter={prefetch}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push(href)}>
          Manage playlist
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
