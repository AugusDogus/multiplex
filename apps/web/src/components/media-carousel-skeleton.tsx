import type { ReactNode } from "react";

import {
  PosterCardSkeleton,
  POSTER_SKELETON_OVERFLOW_COUNT,
} from "~/components/poster-card-skeleton";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

interface MediaCarouselSkeletonProps {
  /** Real section header — preferred when the title is already known. */
  header?: ReactNode;
  showTitle?: boolean;
  titleWidthClassName?: string;
  titleHeightClassName?: string;
  itemCount?: number;
  /** Match loaded MediaCarousel scroll controls (md+). */
  showControls?: boolean;
  gapClassName?: string;
  className?: string;
}

function CarouselControlsSkeleton() {
  return (
    <div className="hidden shrink-0 items-center gap-1 md:flex">
      <Skeleton className="size-8 rounded-md" />
      <Skeleton className="size-8 rounded-md" />
    </div>
  );
}

export function MediaCarouselSkeleton({
  header,
  showTitle = true,
  titleWidthClassName = "w-48",
  titleHeightClassName,
  itemCount = POSTER_SKELETON_OVERFLOW_COUNT,
  showControls = true,
  gapClassName = "gap-3 sm:gap-4",
  className,
}: MediaCarouselSkeletonProps) {
  const title =
    header ??
    (showTitle ? (
      <Skeleton
        className={cn(
          titleHeightClassName ?? "h-7 sm:h-8",
          titleWidthClassName,
        )}
      />
    ) : null);

  return (
    <section className={cn("flex flex-col gap-y-4", className)}>
      {title || showControls ? (
        <div className="flex items-center justify-between gap-4 px-4 md:px-8">
          <div className="min-w-0 flex-1">{title}</div>
          {showControls ? <CarouselControlsSkeleton /> : null}
        </div>
      ) : null}
      <div
        aria-hidden="true"
        className={cn("flex overflow-hidden px-4 pb-4 md:px-8", gapClassName)}
      >
        {Array.from({ length: itemCount }).map((_, index) => (
          <PosterCardSkeleton key={index} />
        ))}
      </div>
    </section>
  );
}

/** Home / Continue Watching row — same posters + controls as other carousels. */
export function ContinueWatchingSkeleton({
  header,
  showTitle = true,
  titleWidthClassName = "w-56",
  itemCount = POSTER_SKELETON_OVERFLOW_COUNT,
}: {
  header?: ReactNode;
  showTitle?: boolean;
  titleWidthClassName?: string;
  itemCount?: number;
} = {}) {
  return (
    <MediaCarouselSkeleton
      header={header}
      showTitle={showTitle}
      titleWidthClassName={titleWidthClassName}
      // Loaded CW title is always text-2xl (32px), including mobile.
      titleHeightClassName="h-8"
      itemCount={itemCount}
      gapClassName="gap-4"
    />
  );
}
