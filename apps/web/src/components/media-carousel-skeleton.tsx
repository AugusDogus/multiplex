import type { ReactNode } from "react";

import { PosterCardSkeleton } from "~/components/poster-card-skeleton";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

const PROGRESS_WIDTH_CLASS_NAMES = [
  "w-3/4",
  "w-1/2",
  "w-2/3",
  "w-5/12",
  "w-4/5",
  "w-3/5",
  "w-7/12",
  "w-2/5",
] as const;

interface MediaCarouselSkeletonProps {
  /** Real section header — preferred when the title is already known. */
  header?: ReactNode;
  showTitle?: boolean;
  titleWidthClassName?: string;
  itemCount?: number;
  showProgress?: boolean;
  /** Match Continue Watching episode cards (2 subtitle lines) when needed. */
  subtitleLines?: 1 | 2;
  gapClassName?: string;
  className?: string;
}

export function MediaCarouselSkeleton({
  header,
  showTitle = true,
  titleWidthClassName = "w-48",
  itemCount = 6,
  showProgress = false,
  subtitleLines = 1,
  gapClassName = "gap-3 sm:gap-4",
  className,
}: MediaCarouselSkeletonProps) {
  const title =
    header ??
    (showTitle ? (
      <Skeleton className={cn("h-7 sm:h-8", titleWidthClassName)} />
    ) : null);

  return (
    <section className={cn("flex flex-col gap-y-4", className)}>
      {title ? (
        <div className="flex items-center justify-between gap-4 px-4 md:px-8">
          <div className="min-w-0 flex-1">{title}</div>
        </div>
      ) : null}
      <div
        aria-hidden="true"
        className={cn("flex overflow-hidden px-4 pb-4 md:px-8", gapClassName)}
      >
        {Array.from({ length: itemCount }).map((_, index) => (
          <PosterCardSkeleton
            key={index}
            showProgress={showProgress}
            subtitleLines={subtitleLines}
            progressWidthClassName={
              PROGRESS_WIDTH_CLASS_NAMES[
                index % PROGRESS_WIDTH_CLASS_NAMES.length
              ]
            }
          />
        ))}
      </div>
    </section>
  );
}

/** Matches the Continue Watching row: portrait posters with progress bars. */
export function ContinueWatchingSkeleton({
  header,
  showTitle = true,
  titleWidthClassName = "w-56",
  itemCount = 8,
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
      itemCount={itemCount}
      showProgress
      subtitleLines={2}
      gapClassName="gap-4"
    />
  );
}
