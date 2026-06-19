"use client";

import type { EmblaCarouselType } from "embla-carousel";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Children,
  isValidElement,
  useSyncExternalStore,
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

interface MediaCarouselControlsProps {
  canGoToPrev: boolean;
  canGoToNext: boolean;
  onGoToPrev: () => void;
  onGoToNext: () => void;
}

function getScrollButtonsSnapshot(
  emblaApi: EmblaCarouselType | undefined,
): string {
  if (!emblaApi) {
    return "00";
  }

  return `${emblaApi.canGoToPrev() ? "1" : "0"}${emblaApi.canGoToNext() ? "1" : "0"}`;
}

function useEmblaScrollButtons(emblaApi: EmblaCarouselType | undefined) {
  const snapshot = useSyncExternalStore(
    (subscribe) => {
      if (!emblaApi) {
        return () => {};
      }

      emblaApi.on("select", subscribe);
      emblaApi.on("reinit", subscribe);
      emblaApi.on("resize", subscribe);
      emblaApi.on("slideschanged", subscribe);

      return () => {
        emblaApi.off("select", subscribe);
        emblaApi.off("reinit", subscribe);
        emblaApi.off("resize", subscribe);
        emblaApi.off("slideschanged", subscribe);
      };
    },
    () => getScrollButtonsSnapshot(emblaApi),
    () => "00",
  );

  return {
    canGoToPrev: snapshot[0] === "1",
    canGoToNext: snapshot[1] === "1",
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
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
  });
  const { canGoToPrev, canGoToNext } = useEmblaScrollButtons(emblaApi);

  const slides = Children.toArray(children);

  return (
    <section className={cn("flex flex-col gap-y-4", className)}>
      {header ? (
        <div className="flex items-center justify-between gap-4 px-4 md:px-8">
          <div className="min-w-0 flex-1">{header}</div>
          <MediaCarouselControls
            canGoToPrev={canGoToPrev}
            canGoToNext={canGoToNext}
            onGoToPrev={() => emblaApi?.goToPrev()}
            onGoToNext={() => emblaApi?.goToNext()}
          />
        </div>
      ) : null}
      <div className="w-full max-w-full overflow-hidden px-4 md:px-8">
        <div ref={emblaRef} className="overflow-hidden pb-4">
          <div className={cn("flex touch-pan-y", gapClassName)}>
            {slides.map((slide, index) => (
              <div
                key={isValidElement(slide) ? (slide.key ?? index) : index}
                className="min-w-0 shrink-0"
              >
                {slide}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
