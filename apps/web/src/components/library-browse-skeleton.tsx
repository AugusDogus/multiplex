import { MediaHubRowSkeleton } from "~/components/media-hub-row";
import { PosterGridSkeleton } from "~/components/poster-grid-skeleton";
import { Skeleton } from "~/components/ui/skeleton";

export function LibraryBrowseSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <MediaHubRowSkeleton />
      <MediaHubRowSkeleton />
      <section className="flex flex-col gap-y-4">
        <div className="px-4 md:px-8">
          <Skeleton className="h-7 w-48" />
        </div>
        <div className="px-4 md:px-8">
          <PosterGridSkeleton rows={2} />
        </div>
      </section>
    </div>
  );
}
