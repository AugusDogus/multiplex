"use client";

import {
  Layers,
  LayoutGrid,
  LibraryBig,
  ListVideo,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import type { LibraryPivot } from "@multiplex/plex-query";
import { SUPPORTED_PIVOT_LABELS } from "~/lib/library-constants";
import { cn } from "~/lib/utils";

const PIVOT_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  recommended: Sparkles,
  library: LibraryBig,
  collections: Layers,
  categories: LayoutGrid,
  playlists: ListVideo,
};

interface LibraryTabsProps {
  pivots: LibraryPivot[];
}

export function LibraryTabs({ pivots }: LibraryTabsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const activePivot = searchParams.get("pivot") ?? "recommended";

  const tabs = pivots.filter((pivot) =>
    Object.prototype.hasOwnProperty.call(SUPPORTED_PIVOT_LABELS, pivot.id),
  );

  if (tabs.length <= 1) {
    return null;
  }

  return (
    <nav
      aria-label="Library views"
      className="scrollbar-hide -mx-1 overflow-x-auto px-1 py-0.5"
    >
      <div className="bg-muted/70 inline-flex items-center gap-1 rounded-full p-1">
        {tabs.map((pivot) => {
          const Icon = PIVOT_ICONS[pivot.id] ?? Sparkles;
          const params = new URLSearchParams();
          if (source) {
            params.set("source", source);
          }
          if (pivot.id !== "recommended") {
            params.set("pivot", pivot.id);
          }
          const isActive = activePivot === pivot.id;

          return (
            <Link
              key={pivot.id}
              href={`${pathname}?${params.toString()}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all",
                "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "size-4 shrink-0 transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              />
              {SUPPORTED_PIVOT_LABELS[pivot.id] ?? pivot.title}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
