"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface MediaCarouselProps {
  children: ReactNode;
  header?: ReactNode;
  className?: string;
  gapClassName?: string;
}

interface ScrollState {
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

function getScrollState(element: HTMLElement): ScrollState {
  const maxScrollLeft = element.scrollWidth - element.clientWidth;

  return {
    canScrollLeft: element.scrollLeft > 1,
    canScrollRight: element.scrollLeft < maxScrollLeft - 1,
  };
}

export function MediaCarousel({
  children,
  header,
  className,
  gapClassName = "gap-4",
}: MediaCarouselProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = useState<ScrollState>({
    canScrollLeft: false,
    canScrollRight: false,
  });

  function attachTrack(node: HTMLDivElement | null) {
    trackRef.current = node;

    if (!node) {
      return;
    }

    const syncScrollState = () => {
      setScrollState(getScrollState(node));
    };

    syncScrollState();

    node.addEventListener("scroll", syncScrollState, { passive: true });

    const resizeObserver = new ResizeObserver(syncScrollState);
    resizeObserver.observe(node);

    const mutationObserver = new MutationObserver(syncScrollState);
    mutationObserver.observe(node, { childList: true, subtree: true });

    return () => {
      node.removeEventListener("scroll", syncScrollState);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }

  function scrollTrack(direction: "left" | "right") {
    const track = trackRef.current;
    if (!track) {
      return;
    }

    const distance = Math.max(track.clientWidth * 0.85, 200);
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    track.scrollBy({
      left: direction === "left" ? -distance : distance,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }

  const showControls = scrollState.canScrollLeft || scrollState.canScrollRight;

  return (
    <section className={cn("flex flex-col gap-y-4", className)}>
      {header ? (
        <div className="flex items-center justify-between gap-4 px-4 md:px-8">
          <div className="min-w-0 flex-1">{header}</div>
          {showControls ? (
            <div className="hidden shrink-0 items-center gap-1 md:flex">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => scrollTrack("left")}
                disabled={!scrollState.canScrollLeft}
                aria-label="Scroll left"
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => scrollTrack("right")}
                disabled={!scrollState.canScrollRight}
                aria-label="Scroll right"
              >
                <ChevronRight />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="w-full max-w-full overflow-hidden">
        <div
          ref={attachTrack}
          className={cn(
            "scrollbar-hide flex overflow-x-auto scroll-smooth px-4 pb-4 md:px-8",
            gapClassName,
          )}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
