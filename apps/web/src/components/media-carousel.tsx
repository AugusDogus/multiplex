"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
  type UIEvent,
} from "react";
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

interface MediaCarouselControlsProps {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  onScrollLeft: () => void;
  onScrollRight: () => void;
}

function getScrollState(element: HTMLElement): ScrollState {
  const maxScrollLeft = element.scrollWidth - element.clientWidth;

  return {
    canScrollLeft: element.scrollLeft > 1,
    canScrollRight: element.scrollLeft < maxScrollLeft - 1,
  };
}

function MediaCarouselControls({
  canScrollLeft,
  canScrollRight,
  onScrollLeft,
  onScrollRight,
}: MediaCarouselControlsProps) {
  return (
    <div className="hidden shrink-0 items-center gap-1 md:flex">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        onClick={onScrollLeft}
        disabled={!canScrollLeft}
        aria-label="Scroll left"
      >
        <ChevronLeft />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        onClick={onScrollRight}
        disabled={!canScrollRight}
        aria-label="Scroll right"
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

export function MediaCarousel({
  children,
  header,
  className,
  gapClassName = "gap-4",
}: MediaCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState<ScrollState>({
    canScrollLeft: false,
    canScrollRight: false,
  });

  function handleTrackScroll(event: UIEvent<HTMLDivElement>) {
    setScrollState(getScrollState(event.currentTarget));
  }

  function handleTrackLoad(event: SyntheticEvent<HTMLDivElement>) {
    setScrollState(getScrollState(event.currentTarget));
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

  return (
    <section className={cn("flex flex-col gap-y-4", className)}>
      {header ? (
        <div className="flex items-center justify-between gap-4 px-4 md:px-8">
          <div className="min-w-0 flex-1">{header}</div>
          <MediaCarouselControls
            canScrollLeft={scrollState.canScrollLeft}
            canScrollRight={scrollState.canScrollRight}
            onScrollLeft={() => scrollTrack("left")}
            onScrollRight={() => scrollTrack("right")}
          />
        </div>
      ) : null}
      <div className="w-full max-w-full overflow-hidden">
        <div
          ref={(node) => {
            trackRef.current = node;
            if (node) {
              setScrollState(getScrollState(node));
            }
          }}
          onScroll={handleTrackScroll}
          onLoadCapture={handleTrackLoad}
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
