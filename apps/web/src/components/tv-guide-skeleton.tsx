import { Skeleton } from "~/components/ui/skeleton";

export function TvGuideSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 shrink-0 rounded-md" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-12 shrink-0 rounded-md" />
            <Skeleton className="h-16 flex-1 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
