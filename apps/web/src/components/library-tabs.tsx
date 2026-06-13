"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { LibraryPivot } from "@multiplex/plex-query";
import { cn } from "~/lib/utils";

const SUPPORTED_PIVOT_LABELS: Record<string, string> = {
  recommended: "Recommended",
  library: "Library",
  collections: "Collections",
  categories: "Categories",
  playlists: "Playlists",
};

export const SUPPORTED_PIVOT_IDS = Object.keys(SUPPORTED_PIVOT_LABELS);

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
    <nav className="border-border/60 -mx-4 border-b px-4 md:-mx-8 md:px-8">
      <div className="scrollbar-hide flex gap-6 overflow-x-auto">
        {tabs.map((pivot) => {
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
                "-mb-px shrink-0 border-b-2 py-3 text-sm font-medium tracking-tight whitespace-nowrap transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {SUPPORTED_PIVOT_LABELS[pivot.id] ?? pivot.title}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
