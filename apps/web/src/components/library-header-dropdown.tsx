"use client";

import { ChevronDown } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { PlexDevice, PlexUserInfo } from "@multiplex/plex-query";
import { LibraryPickerDrawer } from "~/components/library-picker-drawer";
import { useLastLibraryStore } from "~/stores/last-library-store";

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

  // Remember the library route so the mobile "Libraries" tab can return here
  // instead of always snapping back to the first pinned library.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setLastLibraryHref = useLastLibraryStore((state) => state.setHref);
  useEffect(() => {
    const query = searchParams.toString();
    setLastLibraryHref(query ? `${pathname}?${query}` : pathname);
  }, [pathname, searchParams, setLastLibraryHref]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Switch library — currently ${libraryTitle} on ${serverName}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="text-foreground active:bg-accent/60 -m-2 flex max-w-full min-w-0 items-center gap-1.5 rounded-md p-2 text-left"
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
