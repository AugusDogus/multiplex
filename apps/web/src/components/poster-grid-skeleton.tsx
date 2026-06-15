import { PosterCardSkeleton } from "~/components/poster-card-skeleton";
import {
  POSTER_GRID_CONTAINER_CLASSNAME,
  POSTER_GRID_STATIC_CLASSNAME,
} from "~/lib/poster-grid-layout";

const SKELETON_CELL_COUNT = 24;

export function PosterGridSkeleton() {
  return (
    <div className={POSTER_GRID_CONTAINER_CLASSNAME}>
      <div aria-hidden="true" className={POSTER_GRID_STATIC_CLASSNAME}>
        {Array.from({ length: SKELETON_CELL_COUNT }).map((_, index) => (
          <PosterCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
