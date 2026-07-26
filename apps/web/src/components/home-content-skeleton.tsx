import { ContinueWatchingSkeleton } from "~/components/media-carousel-skeleton";
import { MediaHubRowSkeleton } from "~/components/media-hub-row";

export function HomeContentSkeleton() {
  return (
    <>
      <ContinueWatchingSkeleton />
      <MediaHubRowSkeleton />
      <MediaHubRowSkeleton />
    </>
  );
}
