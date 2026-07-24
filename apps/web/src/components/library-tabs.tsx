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
  useEffect,
  useRef,
  useState,
  ViewTransition,
  type ComponentType,
} from "react";
import type {} from "react/canary";
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

/** Shared view-transition name so the active pill morphs between tabs. */
const LIBRARY_TAB_INDICATOR = "library-tab-indicator";

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
  const tabIds = tabs.map((pivot) => pivot.id).join(",");

  useEffect(() => {
    const updateAlignment = () => {
      const element = scrollRef.current;
      if (!element) {
        return;
      }

      setAlignTabs(
        element.scrollWidth > element.clientWidth + 1 ? "start" : "center",
      );
    };

    updateAlignment();

    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(updateAlignment);
    observer.observe(element);

    window.addEventListener("resize", updateAlignment);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateAlignment);
    };
  }, [tabIds]);

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
        "scrollbar-hide md:bg-muted/70 flex w-full max-w-full min-w-0 items-center justify-start gap-2 overflow-x-auto py-0.5 md:w-fit md:gap-1 md:rounded-full md:p-1",
        alignTabs === "center" ? "md:justify-center" : "md:justify-start",
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
        const label = isSupportedPivot(pivot.id)
          ? SUPPORTED_PIVOT_LABELS[pivot.id]
          : pivot.title;

        return (
          <Link
            key={pivot.id}
            href={`${pathname}?${params.toString()}`}
            transitionTypes={["library-tab"]}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-200 ease-out md:rounded-full md:border-0 @5xl/appheader:gap-2 @5xl/appheader:px-4",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:border-border/60 hover:bg-muted/50 hover:text-foreground md:hover:bg-transparent",
            )}
          >
            {isActive ? (
              <ViewTransition
                name={LIBRARY_TAB_INDICATOR}
                share="library-tab-pill"
                default="none"
              >
                <span
                  aria-hidden
                  className="border-border bg-muted absolute inset-0 rounded-lg border shadow-sm md:rounded-full md:border-0 md:bg-background"
                />
              </ViewTransition>
            ) : null}
            <span className="relative inline-flex items-center @5xl/appheader:gap-2">
              <Icon
                className={cn(
                  "hidden size-4 shrink-0 transition-colors duration-200 ease-out @5xl/appheader:block",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              />
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
