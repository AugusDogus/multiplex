"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface MediaCarouselProps {
  children: ReactNode;
  header?: ReactNode;
  className?: string;
  gapClassName?: string;
}

function getScrollOffsets(element: HTMLElement) {
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const { canScrollLeft, canScrollRight } = getScrollOffsets(element);
    setCanScrollLeft(canScrollLeft);
    setCanScrollRight(canScrollRight);
  }, []);

  useEffect(() => {
    updateScrollState();

    const element = scrollRef.current;
    if (!element) {
      return;
    }

    element.addEventListener("scroll", updateScrollState, { passive: true });

    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(element);

    const mutationObserver = new MutationObserver(updateScrollState);
    mutationObserver.observe(element, { childList: true, subtree: true });

    return () => {
      element.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [updateScrollState]);

  const scroll = useCallback((direction: "left" | "right") => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const distance = Math.max(element.clientWidth * 0.85, 200);
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    element.scrollBy({
      left: direction === "left" ? -distance : distance,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, []);

  const showControls = canScrollLeft || canScrollRight;

  return (
    <section className={cn("flex flex-col gap-y-4", className)}>
      {header ? (
        <div className="flex items-center justify-between gap-4 px-4 md:px-8">
          <div className="min-w-0 flex-1">{header}</div>
          {showControls ? (
            <CarouselControls
              canScrollLeft={canScrollLeft}
              canScrollRight={canScrollRight}
              onScrollLeft={() => scroll("left")}
              onScrollRight={() => scroll("right")}
            />
          ) : null}
        </div>
      ) : null}
      <div className="w-full max-w-full overflow-hidden">
        <div
          ref={scrollRef}
          className={cn(
            "scrollbar-hide flex overflow-x-auto px-4 pb-4 md:px-8",
            gapClassName,
          )}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

interface CarouselControlsProps {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  onScrollLeft: () => void;
  onScrollRight: () => void;
}

function CarouselControls({
  canScrollLeft,
  canScrollRight,
  onScrollLeft,
  onScrollRight,
}: CarouselControlsProps) {
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
