import { MediaHubRowSkeleton } from "~/components/media-hub-row";
import { Skeleton } from "~/components/ui/skeleton";

export function LibraryBrowseSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="bg-muted/70 inline-flex w-fit gap-1 rounded-full p-1">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-28 rounded-full" />
        ))}
      </div>
      <div className="flex flex-col gap-8">
        <MediaHubRowSkeleton />
        <MediaHubRowSkeleton />
      </div>
    </div>
  );
}
