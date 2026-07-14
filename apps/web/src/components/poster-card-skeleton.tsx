import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

interface PosterCardSkeletonProps {
  /** Show a Continue Watching-style progress bar at the bottom of the poster. */
  showProgress?: boolean;
  /** Width class for the progress fill (e.g. `w-2/3`). */
  progressWidthClassName?: string;
  /**
   * Number of subtitle lines. Hub/library cards use 1; Continue Watching
   * episodes commonly use 2 — match the loaded card height exactly.
   */
  subtitleLines?: 1 | 2;
  className?: string;
}

export function PosterCardSkeleton({
  showProgress = false,
  progressWidthClassName = "w-2/3",
  subtitleLines = 1,
  className,
}: PosterCardSkeletonProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 [&:nth-child(4n)_[data-poster-skeleton-subtitle]]:w-5/12 [&:nth-child(4n)_[data-poster-skeleton-title]]:w-3/4 [&:nth-child(4n+2)_[data-poster-skeleton-subtitle]]:w-1/2 [&:nth-child(4n+2)_[data-poster-skeleton-title]]:w-11/12 [&:nth-child(4n+3)_[data-poster-skeleton-subtitle]]:w-3/4 [&:nth-child(4n+3)_[data-poster-skeleton-title]]:w-10/12",
        className,
      )}
    >
      <div className="bg-muted relative h-[240px] w-[160px] overflow-hidden rounded-md shadow-lg">
        <Skeleton className="absolute inset-0 rounded-md" />
        {showProgress ? (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-black/60 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
              <div
                className={cn("bg-primary/50 h-full", progressWidthClassName)}
              />
            </div>
          </>
        ) : null}
      </div>
      {/*
        Heights match MediaPosterCard typography:
        title text-sm leading-tight = 17.5px
        subtitle text-xs leading-tight = 15px per line
        meta gap-1 = 4px
      */}
      <div className="flex w-[160px] flex-col gap-1">
        <Skeleton
          data-poster-skeleton-title
          className="h-[17.5px] w-full rounded-sm"
        />
        <div className="flex flex-col">
          <Skeleton
            data-poster-skeleton-subtitle
            className="h-[15px] w-2/3 rounded-sm"
          />
          {subtitleLines === 2 ? (
            <Skeleton className="h-[15px] w-1/2 rounded-sm" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
