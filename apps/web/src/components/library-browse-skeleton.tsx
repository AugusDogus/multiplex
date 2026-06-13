import { MediaHubRowSkeleton } from "~/components/media-hub-row";
import { Skeleton } from "~/components/ui/skeleton";

export function LibraryBrowseSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="border-border/60 -mx-4 flex gap-6 border-b px-4 pb-3 md:-mx-8 md:px-8">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-5 w-24" />
        ))}
      </div>
      <div className="flex flex-col gap-8">
        <MediaHubRowSkeleton />
        <MediaHubRowSkeleton />
      </div>
    </div>
  );
}
