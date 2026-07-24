"use client";

import {
  Layers,
  LayoutGrid,
  LibraryBig,
  ListVideo,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
} from "react";
import { flushSync } from "react-dom";
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

function startLibraryTabTransition(update: () => void) {
  if (typeof document === "undefined" || !("startViewTransition" in document)) {
    update();
    return;
  }

  // jhey-style same-document VT: snapshot → sync DOM update → morph the named
  // active pill. Tag the transition so CSS can suppress the root crossfade.
  const transition = document.startViewTransition(update);
  transition.types?.add("library-tab");
}

export function LibraryTabs({ pivots, className }: LibraryTabsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const scrollRef = useRef<HTMLElement>(null);
  const [alignTabs, setAlignTabs] = useState<"center" | "start">("center");

  const tabs = pivots.filter((pivot) => isSupportedPivot(pivot.id));
  const tabIds = tabs.map((pivot) => pivot.id).join(",");

  // Mirror the page's fallback: an unknown/unsupported pivot renders the
  // Recommended content, so highlight Recommended rather than no tab.
  const requestedPivot = searchParams.get("pivot") ?? "recommended";
  const urlPivot = tabs.some((pivot) => pivot.id === requestedPivot)
    ? requestedPivot
    : "recommended";

  // Optimistic active tab so the pill can morph inside startViewTransition
  // before the App Router search-param update lands. Sync from the URL during
  // render when the route changes (back/forward or external navigation).
  const [activePivot, setActivePivot] = useState(urlPivot);
  const [prevUrlPivot, setPrevUrlPivot] = useState(urlPivot);
  if (urlPivot !== prevUrlPivot) {
    setPrevUrlPivot(urlPivot);
    setActivePivot(urlPivot);
  }

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
        const href = `${pathname}?${params.toString()}`;
        const isActive = activePivot === pivot.id;
        const label = isSupportedPivot(pivot.id)
          ? SUPPORTED_PIVOT_LABELS[pivot.id]
          : pivot.title;

        const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
          if (
            isActive ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.altKey ||
            event.ctrlKey ||
            event.shiftKey
          ) {
            return;
          }

          event.preventDefault();
          startLibraryTabTransition(() => {
            flushSync(() => {
              setActivePivot(pivot.id);
            });
          });
          router.push(href, {
            scroll: false,
            transitionTypes: ["library-tab"],
          });
        };

        return (
          <Link
            key={pivot.id}
            href={href}
            onClick={onClick}
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
              <span
                aria-hidden
                className="border-border bg-muted absolute inset-0 rounded-lg border shadow-sm md:rounded-full md:border-0 md:bg-background"
                style={{ viewTransitionName: LIBRARY_TAB_INDICATOR }}
              />
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
