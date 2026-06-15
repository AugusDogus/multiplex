import type { LibraryPivotId } from "@multiplex/plex-query";

import { LibraryBrowseSkeleton } from "~/components/library-browse-skeleton";
import { PosterGridSkeleton } from "~/components/poster-grid-skeleton";
import { Skeleton } from "~/components/ui/skeleton";
import { POSTER_GRID_INSET_CLASSNAME } from "~/lib/poster-grid-layout";

function LibraryControlsSkeleton() {
  return (
    <div
      aria-hidden="true"
      className={`flex flex-wrap items-center gap-x-1 gap-y-2 ${POSTER_GRID_INSET_CLASSNAME}`}
    >
      <Skeleton className="h-7 w-14 rounded-md" />
      <Skeleton className="h-7 w-20 rounded-md" />
      <Skeleton className="h-7 w-28 rounded-md" />
    </div>
  );
}

function LibraryGridSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <LibraryControlsSkeleton />
      <PosterGridSkeleton />
    </div>
  );
}

function LibraryCategoriesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="aspect-video rounded-lg" />
      ))}
    </div>
  );
}

export function LibraryPivotSkeleton({ pivot }: { pivot: LibraryPivotId }) {
  switch (pivot) {
    case "library":
      return <LibraryGridSkeleton />;

    case "collections":
    case "playlists":
      return <PosterGridSkeleton />;

    case "categories":
      return <LibraryCategoriesSkeleton />;

    case "recommended":
      return <LibraryBrowseSkeleton />;

    default: {
      const _exhaustive: never = pivot;
      return _exhaustive;
    }
  }
}
