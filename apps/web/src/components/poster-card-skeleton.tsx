import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

/** Enough fixed-width posters to overflow a typical desktop content column. */
export const POSTER_SKELETON_OVERFLOW_COUNT = 12;

interface PosterCardSkeletonProps {
  className?: string;
}

/**
 * Single poster-card loading placeholder used everywhere (home hubs,
 * Continue Watching, library grids, virtualized rows, show season strips).
 *
 * Heights match MediaPosterCard with one subtitle line:
 * 240 poster + 8 gap-2 + 17.5 title + 4 gap-1 + 15 subtitle = 284.5px
 */
export function PosterCardSkeleton({ className }: PosterCardSkeletonProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 [&:nth-child(4n)_[data-poster-skeleton-subtitle]]:w-5/12 [&:nth-child(4n)_[data-poster-skeleton-title]]:w-3/4 [&:nth-child(4n+2)_[data-poster-skeleton-subtitle]]:w-1/2 [&:nth-child(4n+2)_[data-poster-skeleton-title]]:w-11/12 [&:nth-child(4n+3)_[data-poster-skeleton-subtitle]]:w-3/4 [&:nth-child(4n+3)_[data-poster-skeleton-title]]:w-10/12",
        className,
      )}
    >
      <Skeleton className="h-[240px] w-[160px] rounded-md" />
      <div className="flex w-[160px] flex-col gap-1">
        <Skeleton
          data-poster-skeleton-title
          className="h-[17.5px] w-full rounded-sm"
        />
        <Skeleton
          data-poster-skeleton-subtitle
          className="h-[15px] w-2/3 rounded-sm"
        />
      </div>
    </div>
  );
}
