import { Skeleton } from "~/components/ui/skeleton";

export function PosterCardSkeleton() {
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <Skeleton className="h-[180px] w-[120px] rounded-md sm:h-[210px] sm:w-[140px] md:h-[240px] md:w-[160px]" />
      <div className="flex w-[120px] flex-col sm:w-[140px] md:w-[160px]">
        <Skeleton className="h-[18px] w-full rounded-sm" />
        <Skeleton className="h-[15px] w-2/3 rounded-sm" />
      </div>
    </div>
  );
}
