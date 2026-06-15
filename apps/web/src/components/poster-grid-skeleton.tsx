import { PosterCardSkeleton } from "~/components/poster-card-skeleton";
import { PosterGridStaticLayout } from "~/components/poster-grid-static-layout";
import { POSTER_GRID_INSET_CLASSNAME } from "~/lib/poster-grid-layout";

const SKELETON_CELL_COUNT = 24;

export function PosterGridSkeleton() {
  return (
    <div
      aria-hidden="true"
      className={`w-full min-w-0 ${POSTER_GRID_INSET_CLASSNAME}`}
    >
      <PosterGridStaticLayout>
        {Array.from({ length: SKELETON_CELL_COUNT }).map((_, index) => (
          <PosterCardSkeleton key={index} />
        ))}
      </PosterGridStaticLayout>
    </div>
  );
}
