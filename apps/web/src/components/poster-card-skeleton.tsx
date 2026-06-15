import { Skeleton } from "~/components/ui/skeleton";
import {
  POSTER_CARD_CONTAINER_CLASSNAME,
  POSTER_HEIGHT_CLASSNAME,
  POSTER_METADATA_WIDTH_CLASSNAME,
  POSTER_WIDTH_CLASSNAME,
} from "~/lib/poster-grid-layout";
import { cn } from "~/lib/utils";

export function PosterCardSkeleton() {
  return (
    <div className={POSTER_CARD_CONTAINER_CLASSNAME}>
      <Skeleton
        className={cn(
          POSTER_HEIGHT_CLASSNAME,
          POSTER_WIDTH_CLASSNAME,
          "rounded-md",
        )}
      />
      <div className={cn("flex flex-col", POSTER_METADATA_WIDTH_CLASSNAME)}>
        <Skeleton className="h-[18px] w-full rounded-sm" />
        <Skeleton className="h-[15px] w-2/3 rounded-sm" />
      </div>
    </div>
  );
}
