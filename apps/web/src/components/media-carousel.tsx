"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Children,
  isValidElement,
  useRef,
  useState,
  type ReactNode,
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

interface MediaCarouselControlsProps {
  canGoToPrev: boolean;
  canGoToNext: boolean;
  onGoToPrev: () => void;
  onGoToNext: () => void;
}

function getScrollButtonState(element: HTMLElement) {
  const maxScrollLeft = element.scrollWidth - element.clientWidth;

  return {
    canGoToPrev: element.scrollLeft > 1,
    canGoToNext: element.scrollLeft < maxScrollLeft - 1,
  };
}

function MediaCarouselControls({
  canGoToPrev,
  canGoToNext,
  onGoToPrev,
  onGoToNext,
}: MediaCarouselControlsProps) {
  if (!canGoToPrev && !canGoToNext) {
    return null;
  }

  return (
    <div className="hidden shrink-0 items-center gap-1 md:flex">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        onClick={onGoToPrev}
        disabled={!canGoToPrev}
        aria-label="Scroll left"
      >
        <ChevronLeft />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        onClick={onGoToNext}
        disabled={!canGoToNext}
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canGoToPrev, setCanGoToPrev] = useState(false);
  const [canGoToNext, setCanGoToNext] = useState(false);

  function updateScrollButtons() {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const { canGoToPrev: nextCanGoToPrev, canGoToNext: nextCanGoToNext } =
      getScrollButtonState(element);

    setCanGoToPrev((current) =>
      current === nextCanGoToPrev ? current : nextCanGoToPrev,
    );
    setCanGoToNext((current) =>
      current === nextCanGoToNext ? current : nextCanGoToNext,
    );
  }

  function handleScroll(_event: UIEvent<HTMLDivElement>) {
    updateScrollButtons();
  }

  function scrollByPage(direction: -1 | 1) {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const distance = Math.max(element.clientWidth * 0.8, 240);
    element.scrollBy({ left: direction * distance, behavior: "smooth" });
  }

  const slides = Children.toArray(children);

  return (
    <section className={cn("flex flex-col gap-y-4", className)}>
      {header ? (
        <div className="flex items-center justify-between gap-4 px-4 md:px-8">
          <div className="min-w-0 flex-1">{header}</div>
          <MediaCarouselControls
            canGoToPrev={canGoToPrev}
            canGoToNext={canGoToNext}
            onGoToPrev={() => scrollByPage(-1)}
            onGoToNext={() => scrollByPage(1)}
          />
        </div>
      ) : null}
      <div
        ref={(node) => {
          scrollRef.current = node;
          if (node) {
            const { canGoToPrev: prev, canGoToNext: next } =
              getScrollButtonState(node);
            setCanGoToPrev(prev);
            setCanGoToNext(next);
          }
        }}
        onScroll={handleScroll}
        onLoadCapture={updateScrollButtons}
        className={cn(
          "scrollbar-hide flex w-full max-w-full overflow-x-auto overscroll-x-contain px-4 pb-4 [-webkit-overflow-scrolling:touch] md:px-8",
          gapClassName,
        )}
      >
        {slides.map((slide, index) => (
          <div
            key={isValidElement(slide) ? (slide.key ?? index) : index}
            className="min-w-0 shrink-0"
          >
            {slide}
          </div>
        ))}
      </div>
    </section>
  );
}
