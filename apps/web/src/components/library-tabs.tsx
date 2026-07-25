"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { LibraryPivot } from "@multiplex/plex-query";
import { LibraryTabLink } from "~/components/library-tab-link";
import { pillStyle, useLibraryTabPill } from "~/hooks/use-library-tab-pill";
import { isSupportedPivot } from "~/lib/library-constants";
import { cn } from "~/lib/utils";

interface LibraryTabsProps {
  pivots: LibraryPivot[];
  className?: string;
}

export function LibraryTabs({ pivots, className }: LibraryTabsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const scrollRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef(new Map<string, HTMLAnchorElement>());
  const clickDrivenRef = useRef(false);
  const [alignTabs, setAlignTabs] = useState<"center" | "start">("center");

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

  const { pill, motionEnabled, movePillToTab, onPillTransitionEnd } =
    useLibraryTabPill({
      pathname,
      source,
      urlPivot,
      activePivot,
      tabIds,
      scrollRef,
      pillRef,
      tabRefs,
      clickDrivenRef,
    });

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

  const onNavigate = (pivotId: string, href: string) => {
    clickDrivenRef.current = true;
    setActivePivot(pivotId);
    movePillToTab(pivotId);
    router.push(href, { scroll: false });
  };

  const registerTab = (pivotId: string, node: HTMLAnchorElement | null) => {
    if (node) {
      tabRefs.current.set(pivotId, node);
    } else {
      tabRefs.current.delete(pivotId);
    }
  };

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
          motionEnabled &&
            "transition-[transform,width,height] duration-[280ms] ease-in-out motion-reduce:transition-none",
          pill.ready ? "opacity-100" : "opacity-0",
        )}
        style={pillStyle(pill)}
      />
      {tabs.map((pivot) => {
        const params = new URLSearchParams();
        if (source) {
          params.set("source", source);
        }
        if (pivot.id !== "recommended") {
          params.set("pivot", pivot.id);
        }
        const query = params.toString();
        const href = query ? `${pathname}?${query}` : pathname;

        return (
          <LibraryTabLink
            key={pivot.id}
            pivot={pivot}
            href={href}
            isActive={activePivot === pivot.id}
            onNavigate={onNavigate}
            registerTab={registerTab}
          />
        );
      })}
    </nav>
  );
}
