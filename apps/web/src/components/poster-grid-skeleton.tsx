import { Skeleton } from "~/components/ui/skeleton";

function PosterSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-[2/3] w-full rounded-md" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export function PosterGridSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 pb-5 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: rows * 6 }).map((_, i) => (
        <PosterSkeleton key={i} />
      ))}
    </div>
  );
}
