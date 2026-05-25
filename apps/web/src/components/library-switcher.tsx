"use client";

import { ChevronDown, ChevronRight, Heart } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  type PlexDevice,
  type PlexUserInfo,
  getPinnedSourceIdentity,
} from "@multiplex/plex-query";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer";
import { getSourceIcon, isUrlActive } from "~/components/sidebar-utils";
import { useServerLibraries } from "~/hooks/use-server-libraries";
import { useSidebarPinning } from "~/hooks/use-sidebar-pinning";
import { getSidebarSources } from "~/hooks/use-sidebar-sources";
import { cn } from "~/lib/utils";

interface LibrarySwitcherProps {
  title: string;
  subtitle?: string | null;
  servers: PlexDevice[];
  userInfo: PlexUserInfo;
}

export function LibrarySwitcher({
  title,
  subtitle,
  servers,
  userInfo,
}: LibrarySwitcherProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const { currentUserInfo } = useSidebarPinning(userInfo);
  const serverLibraries = useServerLibraries(servers);
  const { pinnedSources } = getSidebarSources(currentUserInfo, serverLibraries);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="hover:bg-accent/60 -ml-2 flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors"
      >
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-base font-semibold">{title}</span>
            <ChevronDown
              aria-hidden
              className="text-muted-foreground size-4 shrink-0"
            />
          </span>
          {subtitle && (
            <span className="text-muted-foreground truncate text-xs">
              {subtitle}
            </span>
          )}
        </span>
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-center">
            <DrawerTitle>Favorite libraries</DrawerTitle>
            <DrawerDescription className="sr-only">
              Switch between your favorite libraries.
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            {pinnedSources.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-sm">
                You haven’t favorited any libraries yet.
              </p>
            ) : (
              <ul className="divide-border divide-y border-y">
                {pinnedSources.map((source) => {
                  const Icon = getSourceIcon(source.sourceType);
                  const active = isUrlActive(
                    pathname,
                    searchParams,
                    source.href,
                  );
                  return (
                    <li key={getPinnedSourceIdentity(source)}>
                      <Link
                        href={source.href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "active:bg-accent/40 flex items-center gap-3 py-3.5 transition-colors",
                          active && "text-primary font-medium",
                        )}
                      >
                        <Icon
                          aria-hidden
                          className={cn(
                            "size-4 shrink-0",
                            active ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        <span className="flex min-w-0 flex-1 flex-col leading-tight">
                          <span className="truncate text-base">
                            {source.title}
                          </span>
                          <span className="text-muted-foreground truncate text-xs">
                            {source.serverFriendlyName}
                          </span>
                        </span>
                        {active && (
                          <Heart
                            aria-hidden
                            className="text-primary size-4 shrink-0 fill-current"
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            <Link
              href="/libraries"
              onClick={() => setOpen(false)}
              className="active:bg-accent/40 hover:bg-accent/40 mt-4 flex items-center justify-between gap-2 rounded-md px-2 py-3 text-sm font-medium"
            >
              See all libraries
              <ChevronRight className="text-muted-foreground size-4" />
            </Link>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
