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
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import type { LibraryPivot } from "@multiplex/plex-query";
import {
  SUPPORTED_PIVOT_LABELS,
  isSupportedPivot,
} from "~/lib/library-constants";
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
  className?: string;
}

export function LibraryTabs({ pivots, className }: LibraryTabsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const scrollRef = useRef<HTMLElement>(null);
  const [alignTabs, setAlignTabs] = useState<"center" | "start">("center");

  const tabs = pivots.filter((pivot) => isSupportedPivot(pivot.id));

  const updateAlignment = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    setAlignTabs(
      element.scrollWidth > element.clientWidth + 1 ? "start" : "center",
    );
  }, []);

  useEffect(() => {
    updateAlignment();

    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(updateAlignment);
    observer.observe(element);

    return () => observer.disconnect();
  }, [tabs.length, updateAlignment]);

  if (tabs.length <= 1) {
    return null;
  }

  // Mirror the page's fallback: an unknown/unsupported pivot renders the
  // Recommended content, so highlight Recommended rather than no tab.
  const requestedPivot = searchParams.get("pivot") ?? "recommended";
  const activePivot = tabs.some((pivot) => pivot.id === requestedPivot)
    ? requestedPivot
    : "recommended";

  return (
    <nav
      ref={scrollRef}
      aria-label="Library views"
      className={cn(
        "bg-muted/70 scrollbar-hide flex w-fit max-w-full min-w-0 items-center gap-1 overflow-x-auto rounded-full p-1",
        alignTabs === "center" ? "justify-center" : "justify-start",
        className,
      )}
    >
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
              "flex shrink-0 items-center rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all @5xl/appheader:gap-2 @5xl/appheader:px-4",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon
              className={cn(
                "hidden size-4 shrink-0 transition-colors @5xl/appheader:block",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
            />
            {isSupportedPivot(pivot.id)
              ? SUPPORTED_PIVOT_LABELS[pivot.id]
              : pivot.title}
          </Link>
        );
      })}
    </nav>
  );
}
