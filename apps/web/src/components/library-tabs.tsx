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
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
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

interface PillMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
  ready: boolean;
}

export function LibraryTabs({ pivots, className }: LibraryTabsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const scrollRef = useRef<HTMLElement>(null);
  const tabRefs = useRef(new Map<string, HTMLAnchorElement>());
  const [alignTabs, setAlignTabs] = useState<"center" | "start">("center");
  const [pill, setPill] = useState<PillMetrics>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    ready: false,
  });

  const tabs = pivots.filter((pivot) => isSupportedPivot(pivot.id));
  const tabIds = tabs.map((pivot) => pivot.id).join(",");

  // Mirror the page's fallback: an unknown/unsupported pivot renders the
  // Recommended content, so highlight Recommended rather than no tab.
  const requestedPivot = searchParams.get("pivot") ?? "recommended";
  const urlPivot = tabs.some((pivot) => pivot.id === requestedPivot)
    ? requestedPivot
    : "recommended";

  // Optimistic active tab so the pill can slide before the App Router
  // search-param update lands. Sync from the URL during render on back/forward.
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

  // Measure the active tab and drive a single underlay pill with transform.
  // Live DOM (not View Transition snapshots) so frost/blur and text stacking
  // stay correct while it slides.
  useLayoutEffect(() => {
    const nav = scrollRef.current;
    const activeTab = tabRefs.current.get(activePivot);
    if (!nav || !activeTab) {
      return;
    }

    const updatePill = () => {
      // offset* is relative to the positioned nav and stays correct while the
      // row scrolls horizontally (getBoundingClientRect + scrollLeft can drift).
      setPill({
        x: activeTab.offsetLeft,
        y: activeTab.offsetTop,
        width: activeTab.offsetWidth,
        height: activeTab.offsetHeight,
        ready: true,
      });
    };

    updatePill();

    const observer = new ResizeObserver(updatePill);
    observer.observe(nav);
    observer.observe(activeTab);
    window.addEventListener("resize", updatePill);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePill);
    };
  }, [activePivot, tabIds]);

  if (tabs.length <= 1) {
    return null;
  }

  return (
    <nav
      ref={scrollRef}
      aria-label="Library views"
      className={cn(
        "scrollbar-hide md:bg-muted/70 relative flex w-full max-w-full min-w-0 items-center justify-start gap-2 overflow-x-auto py-0.5 md:w-fit md:gap-1 md:rounded-full md:p-1",
        alignTabs === "center" ? "md:justify-center" : "md:justify-start",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "border-border/60 bg-muted md:bg-background pointer-events-none absolute top-0 left-0 z-0 rounded-lg border shadow-sm md:rounded-full md:border-0 md:shadow-sm",
          "transition-[transform,width,height] duration-[280ms] ease-in-out motion-reduce:transition-none",
          pill.ready ? "opacity-100" : "opacity-0",
        )}
        style={{
          width: pill.width,
          height: pill.height,
          transform: `translate3d(${pill.x}px, ${pill.y}px, 0)`,
        }}
      />
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
          setActivePivot(pivot.id);
          router.push(href, { scroll: false });
        };

        return (
          <Link
            key={pivot.id}
            ref={(node) => {
              if (node) {
                tabRefs.current.set(pivot.id, node);
              } else {
                tabRefs.current.delete(pivot.id);
              }
            }}
            href={href}
            onClick={onClick}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative z-10 flex shrink-0 items-center rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-200 ease-out md:rounded-full md:border-0 @5xl/appheader:gap-2 @5xl/appheader:px-4",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:border-border/60 hover:bg-muted/50 hover:text-foreground md:hover:bg-transparent",
            )}
          >
            <span className="inline-flex items-center @5xl/appheader:gap-2">
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
