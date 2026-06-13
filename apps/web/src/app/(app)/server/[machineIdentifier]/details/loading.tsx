import { AppHeaderSkeleton } from "~/components/app-header-skeleton";
import { MediaItemDetailsSkeleton } from "~/components/media-item-details/media-item-details-skeleton";

export default function MediaItemDetailsLoading() {
  return (
    <>
      <AppHeaderSkeleton />
      <main className="flex min-w-0 flex-1 flex-col p-4">
        <MediaItemDetailsSkeleton />
      </main>
    </>
  );
}
