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
  type CSSProperties,
  type MouseEvent,
  type TransitionEvent,
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

const EMPTY_PILL: PillMetrics = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  ready: false,
};

/**
 * Soft-nav can remount this client tree when the pivot search param changes.
 * Remember pill geometry per library so a remount can continue from the
 * in-flight visual position instead of jumping.
 */
const pillMemory = new Map<string, PillMetrics>();

function memoryKey(pathname: string, source: string | null) {
  return `${pathname}?source=${source ?? ""}`;
}

function pillStyle(metrics: PillMetrics): CSSProperties {
  return {
    width: metrics.width,
    height: metrics.height,
    transform: `translate3d(${metrics.x}px, ${metrics.y}px, 0)`,
  };
}

function readTabMetrics(tab: HTMLElement): PillMetrics {
  return {
    x: tab.offsetLeft,
    y: tab.offsetTop,
    width: tab.offsetWidth,
    height: tab.offsetHeight,
    ready: true,
  };
}

/** Where the pill is on screen right now — including mid-transition. */
function readPillVisualMetrics(pill: HTMLElement): PillMetrics | null {
  const style = getComputedStyle(pill);
  if (style.transform === "none") {
    return null;
  }

  const matrix = new DOMMatrixReadOnly(style.transform);
  const width = Number.parseFloat(style.width);
  const height = Number.parseFloat(style.height);
  if (
    !Number.isFinite(matrix.m41) ||
    !Number.isFinite(matrix.m42) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    x: matrix.m41,
    y: matrix.m42,
    width,
    height,
    ready: true,
  };
}

export function LibraryTabs({ pivots, className }: LibraryTabsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const key = memoryKey(pathname, source);
  const scrollRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef(new Map<string, HTMLAnchorElement>());
  const slidingRef = useRef(false);
  const moveRafRef = useRef(0);
  const clickDrivenRef = useRef(false);
  const restoredFromMemory = Boolean(pillMemory.get(key)?.ready);
  const restoredFromMemoryRef = useRef(restoredFromMemory);
  const hasMeasuredRef = useRef(restoredFromMemory);
  const [alignTabs, setAlignTabs] = useState<"center" | "start">("center");
  const [pill, setPill] = useState<PillMetrics>(
    () => pillMemory.get(key) ?? EMPTY_PILL,
  );

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

  const persistPill = (metrics: PillMetrics) => {
    setPill(metrics);
    pillMemory.set(key, metrics);
  };

  /**
   * Retarget the pill from its live visual position to a tab. Capturing the
   * computed transform (not the destination tab box) keeps mid-flight clicks
   * interruptible — CSS continues from where the pill actually is.
   */
  const movePillToTab = (pivotId: string, options?: { snap?: boolean }) => {
    const targetTab = tabRefs.current.get(pivotId);
    if (!targetTab) {
      return;
    }

    cancelAnimationFrame(moveRafRef.current);

    const target = readTabMetrics(targetTab);
    const pillElement = pillRef.current;
    const visual =
      pillElement && hasMeasuredRef.current
        ? readPillVisualMetrics(pillElement)
        : null;

    if (options?.snap || !visual || !pillElement) {
      hasMeasuredRef.current = true;
      slidingRef.current = false;
      persistPill(target);
      return;
    }

    // Freeze at the current computed geometry (no transition), sync React,
    // then aim at the new tab so an in-flight slide can reverse/retarget.
    const previousTransition = pillElement.style.transition;
    pillElement.style.transition = "none";
    pillElement.style.width = `${visual.width}px`;
    pillElement.style.height = `${visual.height}px`;
    pillElement.style.transform = `translate3d(${visual.x}px, ${visual.y}px, 0)`;
    void pillElement.offsetWidth;
    pillElement.style.transition = previousTransition;

    flushSync(() => {
      setPill(visual);
    });
    pillMemory.set(key, visual);
    slidingRef.current = true;
    hasMeasuredRef.current = true;

    moveRafRef.current = requestAnimationFrame(() => {
      setPill(target);
    });
  };

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

  useLayoutEffect(() => {
    const nav = scrollRef.current;
    const activeTab = tabRefs.current.get(activePivot);
    if (!nav || !activeTab) {
      return;
    }

    // Clicks drive the pill themselves so rapid re-clicks stay interruptible.
    if (clickDrivenRef.current) {
      clickDrivenRef.current = false;
    } else if (!hasMeasuredRef.current && !restoredFromMemoryRef.current) {
      movePillToTab(activePivot, { snap: true });
    } else {
      movePillToTab(activePivot);
    }

    const onScrollOrResize = () => {
      if (slidingRef.current) {
        return;
      }
      const tab = tabRefs.current.get(activePivot);
      if (tab) {
        persistPill(readTabMetrics(tab));
      }
    };

    const observer = new ResizeObserver(onScrollOrResize);
    observer.observe(nav);
    observer.observe(activeTab);
    nav.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      observer.disconnect();
      nav.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
    // movePillToTab closes over key/refs; activePivot/tabIds/key are the signals.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [activePivot, tabIds, key]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(moveRafRef.current);
    };
  }, []);

  const onPillTransitionEnd = (event: TransitionEvent<HTMLSpanElement>) => {
    if (event.propertyName !== "transform") {
      return;
    }
    slidingRef.current = false;
    const activeTab = tabRefs.current.get(activePivot);
    if (activeTab) {
      pillMemory.set(key, readTabMetrics(activeTab));
    }
  };

  if (tabs.length <= 1) {
    return null;
  }

  return (
    <nav
      ref={scrollRef}
      aria-label="Library views"
      className={cn(
        "scrollbar-hide md:bg-muted relative flex w-full max-w-full min-w-0 items-center justify-start gap-2 overflow-x-auto bg-transparent py-0.5 md:w-fit md:gap-1 md:rounded-full md:p-1",
        alignTabs === "center" ? "md:justify-center" : "md:justify-start",
        className,
      )}
    >
      <span
        ref={pillRef}
        aria-hidden
        onTransitionEnd={onPillTransitionEnd}
        className={cn(
          "border-border/60 bg-muted md:bg-background pointer-events-none absolute top-0 left-0 z-0 rounded-lg border shadow-sm md:rounded-full md:border-0 md:shadow-sm",
          "transition-[transform,width,height] duration-[280ms] ease-in-out motion-reduce:transition-none",
          pill.ready ? "opacity-100" : "opacity-0",
        )}
        style={pillStyle(pill)}
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
          clickDrivenRef.current = true;
          setActivePivot(pivot.id);
          movePillToTab(pivot.id);
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
