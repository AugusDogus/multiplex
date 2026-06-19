import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

import "./media-carousel.css";

interface MediaCarouselProps {
  children: ReactNode;
  header?: ReactNode;
  className?: string;
  gapClassName?: string;
}

export function MediaCarousel({
  children,
  header,
  className,
  gapClassName = "gap-4",
}: MediaCarouselProps) {
  return (
    <section className={cn("media-carousel flex flex-col gap-y-4", className)}>
      {header ? (
        <div className="media-carousel__header flex min-h-8 items-center justify-between gap-4 px-4 md:px-8">
          <div className="min-w-0 flex-1">{header}</div>
        </div>
      ) : null}
      <div className="w-full max-w-full overflow-hidden">
        <div
          className={cn(
            "media-carousel__track scrollbar-hide flex overflow-x-auto px-4 pb-4 md:px-8",
            gapClassName,
          )}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
