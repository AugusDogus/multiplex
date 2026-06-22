import { AppHeader } from "~/components/app-header";
import { MediaItemDetailsSkeleton } from "~/components/media-item-details/media-item-details-skeleton";

export default function MediaDetailsLoading() {
  return (
    <>
      <AppHeader />
      <main className="flex min-w-0 flex-1 flex-col p-4">
        <MediaItemDetailsSkeleton variant="media" />
      </main>
    </>
  );
}
