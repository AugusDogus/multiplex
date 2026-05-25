"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { PlexDevice, PlexUserInfo } from "@multiplex/plex-query";
import { LibraryPickerDrawer } from "~/components/library-picker-drawer";

interface LibraryHeaderDropdownProps {
  libraryTitle: string;
  serverName: string;
  servers: PlexDevice[];
  userInfo: PlexUserInfo;
}

export function LibraryHeaderDropdown({
  libraryTitle,
  serverName,
  servers,
  userInfo,
}: LibraryHeaderDropdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Switch library — currently ${libraryTitle} on ${serverName}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="text-foreground -m-2 flex min-w-0 max-w-full items-center gap-1.5 rounded-md p-2 text-left active:bg-accent/60"
      >
        <div className="grid min-w-0 leading-tight">
          <span className="truncate text-base font-semibold tracking-tight">
            {libraryTitle}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {serverName}
          </span>
        </div>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" />
      </button>

      <LibraryPickerDrawer
        open={open}
        onOpenChange={setOpen}
        servers={servers}
        userInfo={userInfo}
        initialView="favorites"
      />
    </>
  );
}
