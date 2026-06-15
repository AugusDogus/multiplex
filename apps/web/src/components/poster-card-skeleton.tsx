import { Skeleton } from "~/components/ui/skeleton";

export function PosterCardSkeleton() {
  return (
    <div className="flex shrink-0 flex-col gap-2 [&:nth-child(4n)_[data-poster-skeleton-subtitle]]:w-5/12 [&:nth-child(4n)_[data-poster-skeleton-title]]:w-3/4 [&:nth-child(4n+2)_[data-poster-skeleton-subtitle]]:w-1/2 [&:nth-child(4n+2)_[data-poster-skeleton-title]]:w-11/12 [&:nth-child(4n+3)_[data-poster-skeleton-subtitle]]:w-3/4 [&:nth-child(4n+3)_[data-poster-skeleton-title]]:w-10/12">
      <Skeleton className="h-[180px] w-[120px] rounded-md sm:h-[210px] sm:w-[140px] md:h-[240px] md:w-[160px]" />
      <div className="flex w-[120px] flex-col gap-1 sm:w-[140px] md:w-[160px]">
        <Skeleton
          data-poster-skeleton-title
          className="h-[18px] w-full rounded-sm"
        />
        <Skeleton
          data-poster-skeleton-subtitle
          className="h-[15px] w-2/3 rounded-sm"
        />
      </div>
    </div>
  );
}
