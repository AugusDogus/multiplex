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
    <div
      className={cn(
        "group/carousel relative w-full max-w-full overflow-hidden",
        className,
      )}
    >
      {showControls ? (
        <>
          <CarouselArrow
            direction="left"
            disabled={!canScrollLeft}
            onClick={() => scroll("left")}
          />
          <CarouselArrow
            direction="right"
            disabled={!canScrollRight}
            onClick={() => scroll("right")}
          />
        </>
      ) : null}
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
  );
}

interface CarouselArrowProps {
  direction: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}

function CarouselArrow({ direction, disabled, onClick }: CarouselArrowProps) {
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      className={cn(
        "bg-background/90 absolute top-1/2 z-10 hidden size-9 -translate-y-1/2 rounded-full shadow-md backdrop-blur-sm transition-opacity duration-150 md:flex",
        direction === "left" ? "left-3 md:left-5" : "right-3 md:right-5",
        "opacity-0 group-hover/carousel:opacity-100 focus-visible:opacity-100",
        disabled && "pointer-events-none opacity-0",
      )}
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "left" ? "Scroll left" : "Scroll right"}
    >
      <Icon />
    </Button>
  );
}
